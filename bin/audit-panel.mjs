#!/usr/bin/env node
/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// audit-panel — merge lens output into a report, SARIF, or a calibration score.
//
// This CLI does not dispatch lenses; your agent harness does that (see
// foreman.md). It takes what the lenses returned and does the deterministic
// half: parse, merge, dedupe, score consensus, apply a baseline, emit.
//
// Input is JSON on stdin or via --in:
//   [{"lens": "check", "output": "lib/a.js:41 — BLOCK — issue — fix"},
//    {"lens": "ux", "output": null}]        <- null means the lens died
//
// Usage:
//   audit-panel report            [--in run.json] [--baseline b.json]
//   audit-panel sarif             [--in run.json] [--baseline b.json] [--out x.sarif]
//   audit-panel baseline          [--in run.json] --out baseline.json
//   audit-panel overlap           [--in run.json] [--out overlap.json]
//   audit-panel calibrate         [--in run.json] --expected expected.json
//
// Options: --overlap <file>  independence data from `overlap` (report/sarif)
//          --lenses <dir>    lens directory for SARIF rule metadata

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatScore, score } from '../lib/calibrate.mjs';
import { parseFrontmatter } from '../lib/lenses.mjs';
import {
  countsBySeverity, lensOverlap, mergeFindings, panelVerdict
} from '../lib/merge.mjs';
import { filterAgainstBaseline, staleBaselineEntries, toBaseline }
  from '../lib/baseline.mjs';
import { parseReports } from '../lib/parse.mjs';
import { toSarifJson } from '../lib/sarif.mjs';

function fail(message) {
  process.stderr.write(`audit-panel: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      fail(`unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = rest[i + 1];
    if (value == null || value.startsWith('--')) {
      fail(`--${key} requires a value`);
    }
    options[key] = value;
    i += 1;
  }
  return { command, options };
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
  for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const parsed = parseFrontmatter(readFileSync(join(dir, file), 'utf8'));
    if (parsed?.name) {
      meta[parsed.name] = parsed;
    }
  }
  return meta;
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
  out.push('# Audit Panel');
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
    process.stderr.write(`audit-panel: wrote ${options.out}\n`);
  } else {
    process.stdout.write(text);
  }
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8')
      .split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3))
      .join('\n') + '\n');
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

main();
