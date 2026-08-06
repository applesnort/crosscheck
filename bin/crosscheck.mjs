#!/usr/bin/env node
/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// crosscheck — run a review panel, or merge output a panel already produced.
//
// `run` dispatches the lenses and reports. The other commands take lens output
// that already exists and do the deterministic half: parse, merge, dedupe, score
// consensus, apply a baseline, emit.
//
// crosscheck never talks to a model itself. `run --exec` names a command that
// receives one lens prompt on stdin and returns findings on stdout, so any agent
// CLI or wrapper works.
//
// For the commands below other than `run`, input is JSON on stdin or via --in:
//   [{"lens": "check", "output": "lib/a.js:41 — BLOCK — issue — fix"},
//    {"lens": "ux", "output": null}]        <- null means the lens died
//
// Usage:
//   crosscheck run <path...>     --exec '<command>'  [--lenses dir] [--only a,b]
//                                [--skip x,y] [--concurrency N] [--out run.json]
//                                [--sarif f] [--baseline b] [--mixed] [--dry-run]
//   crosscheck report            [--in run.json] [--baseline b.json]
//   crosscheck sarif             [--in run.json] [--baseline b.json] [--out x.sarif]
//   crosscheck baseline          [--in run.json] --out baseline.json
//   crosscheck overlap           [--in run.json] [--out overlap.json]
//   crosscheck calibrate         [--in run.json] --expected expected.json
//
// Options: --overlap <file>  independence data from `overlap` (report/sarif)
//          --lenses <dir>    lens directory (routing + SARIF rule metadata)
//
// `run` dispatches the lenses itself. crosscheck never talks to a model: --exec
// names a command that receives one lens prompt on stdin and returns findings on
// stdout, so any agent CLI works. Examples:
//   crosscheck run lib/ --exec 'claude -p'
//   crosscheck run lib/ --exec 'llm -m gpt-4o'
//   crosscheck run lib/ --exec 'my-wrapper --json' --concurrency 2
// Use --dry-run to print the roster and prompts without spawning anything.

import { spawn } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, statSync, writeFileSync
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { formatScore, score } from '../lib/calibrate.mjs';
import { parseFrontmatter } from '../lib/lenses.mjs';
import {
  countsBySeverity, lensOverlap, mergeFindings, panelVerdict
} from '../lib/merge.mjs';
import { filterAgainstBaseline, staleBaselineEntries, toBaseline }
  from '../lib/baseline.mjs';
import { parseReports } from '../lib/parse.mjs';
import { planRun, promptsFor, runPanel } from '../lib/run.mjs';
import { toSarifJson } from '../lib/sarif.mjs';

function fail(message) {
  process.stderr.write(`crosscheck: ${message}\n`);
  process.exit(2);
}

const BOOLEAN_FLAGS = new Set(['dry-run', 'mixed']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      options[key] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value == null || value.startsWith('--')) {
      fail(`--${key} requires a value`);
    }
    options[key] = value;
    i += 1;
  }
  return { command, options, positional };
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function loadRun(options) {
  const raw = options.in ? readFileSync(options.in, 'utf8') : readStdin();
  if (!raw.trim()) {
    fail('no input — pass --in <file> or pipe lens output JSON on stdin');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`input is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    fail('input must be an array of {lens, output} objects');
  }
  return parsed;
}

function loadJson(path) {
  return path ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function loadLensMeta(dir) {
  if (!dir) {
    return {};
  }
  const meta = {};
  for (const lens of loadLenses(dir)) {
    meta[lens.name] = lens;
  }
  return meta;
}

// Lens directory: an explicit --lenses, else ./lenses, else the copy shipped
// with the package. Resolved loudly so a typo does not silently run zero lenses.
function resolveLensDir(dir) {
  const candidates = dir
    ? [resolve(dir)]
    : [resolve('lenses'), new URL('../lenses/', import.meta.url).pathname];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  fail(`no lens directory found (looked in ${candidates.join(', ')})`);
}

function loadLenses(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  const lenses = [];
  for (const file of files) {
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    const meta = parseFrontmatter(text);
    if (!meta?.name) {
      process.stderr.write(
        `crosscheck: skipping ${file} — no frontmatter with a name\n`);
      continue;
    }
    lenses.push({ ...meta, definition: text, definitionPath: path });
  }
  if (lenses.length === 0) {
    fail(`no usable lens definitions in ${dir}`);
  }
  return lenses;
}

// Expand the positional targets into a concrete file list. Directories are walked;
// everything is reported relative to cwd so paths in findings match what the user
// typed.
function collectFiles(targets) {
  const out = [];
  const walk = path => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry === 'node_modules' || entry.startsWith('.')) {
          continue;
        }
        walk(join(path, entry));
      }
      return;
    }
    out.push(relative(process.cwd(), path) || path);
  };
  for (const target of targets) {
    if (!existsSync(target)) {
      fail(`no such path: ${target}`);
    }
    walk(target);
  }
  if (out.length === 0) {
    fail('the target expanded to zero files');
  }
  return out.sort();
}

// Spawn the user's command with the prompt on stdin. crosscheck stays agnostic
// about which model or framework produced the text.
function execCommand(commandLine) {
  return ({ prompt }) => new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(commandLine, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', rejectPromise);
    child.on('close', code => resolvePromise({ stdout, stderr, code }));
    child.stdin.on('error', rejectPromise);
    child.stdin.end(prompt);
  });
}

function buildMerged(options) {
  const reports = parseReports(loadRun(options));
  const overlap = loadJson(options.overlap) ?? undefined;
  const merged = mergeFindings(reports, { overlap });
  const baseline = loadJson(options.baseline);
  if (!baseline) {
    return { merged, reports, suppressed: [], stale: [] };
  }
  const { findings, suppressed } =
    filterAgainstBaseline(merged.findings, baseline);
  const stale = staleBaselineEntries(baseline, merged.findings);
  return {
    merged: { ...merged, findings }, reports, suppressed, stale
  };
}

function report({ merged, suppressed, stale }) {
  const counts = countsBySeverity(merged.findings);
  const out = [];
  out.push('# Crosscheck report');
  if (merged.incomplete.length) {
    out.push('', `**Did not complete: ${merged.incomplete.join(', ')}** — ` +
      'their coverage is missing from this report.');
  }
  if (suppressed.length) {
    out.push('', `Suppressed by baseline: ${suppressed.length}.`);
  }
  if (stale.length) {
    out.push('', `Baseline entries no longer reported: ${stale.length} — ` +
      'either fixed, or a lens stopped running.');
  }
  if (merged.unparsed.length) {
    out.push('', `Unparsed lens lines: ${merged.unparsed.length} ` +
      `(${[...new Set(merged.unparsed.map(u => u.lens))].join(', ')}).`);
  }
  for (const severity of ['BLOCK', 'FIX', 'CONSIDER']) {
    const group = merged.findings.filter(f => f.severity === severity);
    out.push('', `## ${severity} (${group.length})`);
    if (group.length === 0) {
      out.push('None.');
      continue;
    }
    for (const f of group) {
      const who = f.consensus
        ? `CONSENSUS ${f.consensusScore}: ${f.lenses.join(', ')}`
        : f.lenses.join(', ');
      out.push(`- [${who}] ${f.file}:${f.line} — ${f.issue}` +
        (f.fix ? ` — ${f.fix}` : ''));
    }
  }
  out.push('', '## Panel verdict',
    `${panelVerdict(counts)} — ${counts.BLOCK} block, ${counts.FIX} fix, ` +
    `${counts.CONSIDER} consider; ` +
    `${merged.findings.filter(f => f.consensus).length} consensus.`);
  return out.join('\n') + '\n';
}

function write(options, text) {
  if (options.out) {
    writeFileSync(options.out, text);
    process.stderr.write(`crosscheck: wrote ${options.out}\n`);
  } else {
    process.stdout.write(text);
  }
}

async function runCommand(options, positional) {
  if (positional.length === 0) {
    fail('run needs at least one path to audit');
  }
  if (!options.exec && !options['dry-run']) {
    fail("run needs --exec '<command>' (or --dry-run to see the prompts)");
  }
  const files = collectFiles(positional);
  const lensDir = resolveLensDir(options.lenses);
  const lenses = loadLenses(lensDir);
  const overrides = {
    only: options.only?.split(',').map(s => s.trim()).filter(Boolean),
    skip: options.skip?.split(',').map(s => s.trim()).filter(Boolean)
  };
  const { roster, skipped } = planRun(lenses, files, overrides);

  process.stderr.write(
    `crosscheck: ${files.length} file(s), lenses from ${lensDir}\n` +
    `  roster:  ${roster.map(l => l.name).join(', ') || '(none)'}\n` +
    (skipped.length
      ? skipped.map(s => `  skipped: ${s.lens} — ${s.reason}`).join('\n') + '\n'
      : ''));

  if (roster.length === 0) {
    fail('no lens matched the target; nothing to run');
  }

  const promptOptions = { mixedCorpus: Boolean(options.mixed) };

  if (options['dry-run']) {
    for (const job of promptsFor(roster, promptOptions)) {
      process.stdout.write(
        `\n===== ${job.lens} (${job.files.length} file(s)) =====\n${job.prompt}\n`);
    }
    return;
  }

  const { reports, failures } = await runPanel({
    roster,
    skipped,
    exec: execCommand(options.exec),
    concurrency: Number(options.concurrency ?? 4),
    promptOptions,
    onLensStart: lens => process.stderr.write(`  → ${lens}\n`),
    onLensDone: (lens, r) => process.stderr.write(
      r.ok ? `  ✓ ${lens} (${r.findings} finding(s))\n` : `  ✗ ${lens} did not complete\n`)
  });

  for (const f of failures) {
    process.stderr.write(`crosscheck: ${f.lens} failed — ${f.reason}\n`);
  }

  // The raw lens output is written out whenever asked, so a run can be rescored
  // later without paying for the model again.
  if (options.out) {
    writeFileSync(options.out, JSON.stringify(
      reports.map(r => ({ lens: r.lens, output: r.output ?? null })),
      null, 2) + '\n');
    process.stderr.write(`crosscheck: wrote ${options.out}\n`);
  }

  const overlap = loadJson(options.overlap) ?? undefined;
  let merged = mergeFindings(reports, { overlap });
  let suppressed = [];
  let stale = [];
  const baseline = loadJson(options.baseline);
  if (baseline) {
    const filtered = filterAgainstBaseline(merged.findings, baseline);
    stale = staleBaselineEntries(baseline, merged.findings);
    suppressed = filtered.suppressed;
    merged = { ...merged, findings: filtered.findings };
  }

  process.stdout.write(report({ merged, suppressed, stale }));

  if (options.sarif) {
    writeFileSync(options.sarif, toSarifJson(merged, {
      lensMeta: loadLensMeta(lensDir)
    }));
    process.stderr.write(`crosscheck: wrote ${options.sarif}\n`);
  }

  // A panel missing a lens has not produced a full review; say so in the exit
  // code as well as the report.
  if (failures.length > 0) {
    process.exit(1);
  }
}

async function main() {
  const { command, options, positional } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8')
      .split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3))
      .join('\n') + '\n');
    return;
  }

  if (command === 'run') {
    await runCommand(options, positional);
    return;
  }

  if (command === 'report') {
    write(options, report(buildMerged(options)));
    return;
  }

  if (command === 'sarif') {
    const { merged } = buildMerged(options);
    write(options, toSarifJson(merged, {
      lensMeta: loadLensMeta(options.lenses)
    }));
    return;
  }

  if (command === 'baseline') {
    const { merged } = buildMerged({ ...options, baseline: undefined });
    if (!options.out) {
      fail('baseline requires --out <file>');
    }
    write({ out: options.out },
      JSON.stringify(toBaseline(merged.findings, {
        note: 'Findings present before this baseline was taken.'
      }), null, 2) + '\n');
    return;
  }

  if (command === 'overlap') {
    const reports = parseReports(loadRun(options));
    write(options, JSON.stringify(lensOverlap(reports), null, 2) + '\n');
    return;
  }

  if (command === 'calibrate') {
    if (!options.expected) {
      fail('calibrate requires --expected <expected.json>');
    }
    const { merged } = buildMerged(options);
    const result = score(merged.findings, loadJson(options.expected));
    process.stdout.write(formatScore(result) + '\n');
    // A panel that missed a planted defect is a failing panel.
    process.exit(result.missed.length > 0 ? 1 : 0);
  }

  fail(`unknown command: ${command}`);
}

await main();
