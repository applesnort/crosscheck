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
// CLI or wrapper works. Since 0.9.0 the prompt carries the source it reviews, so
// a bare model endpoint with no file access works too; --no-embed restores the
// older prompt that names files and expects the runner to open them.
//
// For the commands below other than `run`, input is JSON on stdin or via --in:
//   [{"lens": "check", "output": "lib/a.js:41 — BLOCK — issue — fix"},
//    {"lens": "ux", "output": null}]        <- null means the lens died
//
// Usage:
//   crosscheck run <path...|--diff|--staged|--since <ref>>
//                                --exec '<command>'  [--lenses dir] [--only a,b]
//                                [--skip x,y] [--concurrency N] [--out run.json]
//                                [--sarif f] [--baseline b] [--mixed] [--dry-run]
//                                [--budget N] [--triage '<cheap command>']
//                                [--no-embed] [--hunk-context N]
//   crosscheck init              [--force]   scaffold config, lenses, workflow
//   crosscheck lenses            [--lenses dir,dir] [--no-builtin]
//   crosscheck report            [--in run.json] [--baseline b.json]
//   crosscheck sarif             [--in run.json] [--baseline b.json] [--out x.sarif]
//   crosscheck baseline          [--in run.json] --out baseline.json
//   crosscheck overlap           [--in run.json] [--out overlap.json]
//   crosscheck calibrate         [--in run.json] --expected expected.json
//
// Options: --overlap <file>  independence data from `overlap` (report/sarif)
//          --lenses <dir>    lens directory (routing + SARIF rule metadata)
//          --max-dispatches N  cap lens runs; dropped lenses are named, never
//                            silently omitted.
//          --budget N        cap estimated INPUT tokens. Lenses run in roster
//                            order until the estimate is spent; the rest are
//                            named. The estimate covers the prompt crosscheck
//                            builds — not the runner's preamble, its reasoning,
//                            nor any output — and says so wherever it prints.
//          --triage '<cmd>'  cheap pass over everything first, then the real
//                            panel over only the files it flagged. Trades
//                            recall for spend: what triage misses, the panel
//                            never sees. The narrowing is always reported.
//          --no-embed        do not inline source; name the files and let the
//                            runner open them, as before 0.9.0.
//          --hunk-context N  context lines around changed lines for a lens
//                            declaring `scope: hunks` (default 6)
//
// A lens that finds nothing states what it examined, on COVERAGE lines before
// its NO FINDINGS. A bare NO FINDINGS still parses and is reported as
// unsupported: it is compatible with a clean file, a lens that could not
// recognise the defect, and a lens whose questions exceed its runner, so it
// forbids nothing and cannot be wrong. A lens may declare `invariants` in its
// body to trade prose judgement for checks that can fail mechanically.
//          --comment-file <f>  write a pull-request summary comment
//          --no-cache        do not read or write .crosscheck/cache
//          --cache-dir <dir> relocate the cache
//          --config <file>   config file (default: nearest .crosscheckrc.json,
//                            searching upward and stopping at a repo root)
//
// Settings may live in .crosscheckrc.json so a team shares one panel definition
// instead of a shell alias nobody else can see. Command-line flags win over it.
//   {"exec": "claude -p", "concurrency": 2, "skip": ["ux"]}
//
// `run` dispatches the lenses itself. crosscheck never talks to a model: --exec
// names a command that receives one lens prompt on stdin and returns findings on
// stdout, so any agent CLI works. Examples:
//   crosscheck run lib/ --exec 'claude -p'
//   crosscheck run lib/ --exec 'llm -m gpt-4o'
//   crosscheck run lib/ --exec 'my-wrapper --json' --concurrency 2
// Use --dry-run to print the roster and prompts without spawning anything.

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatScore, score } from '../lib/calibrate.mjs';
import { findConfig, mergeConfig, validateConfig } from '../lib/config.mjs';
import {
  parseFrontmatter, parseInvariants, resolveLensSet, validateLens
} from '../lib/lenses.mjs';
import {
  applyVerdicts, countsBySeverity, lensOverlap, mergeFindings, panelVerdict
} from '../lib/merge.mjs';
import { filterAgainstBaseline, staleBaselineEntries, toBaseline }
  from '../lib/baseline.mjs';
import { parseReports } from '../lib/parse.mjs';
import {
  narrowRosterToFindings,
  planRun, promptsFor, resolveExec, runPanel, verifyFindings
} from '../lib/run.mjs';
import { cacheKey, createCache } from '../lib/cache.mjs';
import { buildComment } from '../lib/comment.mjs';
import { toSarifJson } from '../lib/sarif.mjs';
import { diffCommand, targetFromDiff, withContext } from '../lib/target.mjs';

function fail(message) {
  process.stderr.write(`crosscheck: ${message}\n`);
  process.exit(2);
}

// --diff is boolean rather than taking an optional ref: `run --diff src/` would
// otherwise be ambiguous about whether src/ is a ref or a path. Use --since <ref>
// to compare against something.
const BOOLEAN_FLAGS = new Set([
  'dry-run', 'mixed', 'no-builtin', 'staged', 'verify', 'no-verify', 'diff',
  'no-cache', 'force', 'no-embed'
]);

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

// fileURLToPath, not `.pathname`: a URL path is not a filesystem path. It keeps
// percent-escapes, so any install directory containing a space resolves to
// nothing, and on Windows it carries a leading slash before the drive letter.
const BUILTIN_LENS_DIR = resolve(
  fileURLToPath(new URL('../lenses/', import.meta.url)));

// Lens sources, in increasing precedence: the packaged lenses, then ./lenses or
// .crosscheck/lenses if present, then anything named by --lenses. Layering
// rather than replacing means adding one lens costs one file instead of forking
// all of them and losing upstream changes.
function lensSources(option, { includeBuiltin = true } = {}) {
  const dirs = [];
  if (includeBuiltin) {
    dirs.push(BUILTIN_LENS_DIR);
  }
  for (const local of ['lenses', '.crosscheck/lenses']) {
    const path = resolve(local);
    if (existsSync(path) && path !== resolve(BUILTIN_LENS_DIR)) {
      dirs.push(path);
    }
  }
  const explicit = Array.isArray(option)
    ? option
    : (option ? String(option).split(',').map(d => d.trim()).filter(Boolean) : []);
  for (const dir of explicit) {
    const path = resolve(dir);
    if (!existsSync(path)) {
      fail(`no such lens directory: ${dir}`);
    }
    dirs.push(path);
  }
  if (dirs.length === 0) {
    fail('no lens directories to load (--no-builtin with no --lenses?)');
  }
  // The same directory can arrive twice — ./lenses is auto-detected, and running
  // from that project also names it via --lenses. Loading it twice makes every
  // lens in it shadow itself, which reads as a configuration mistake that is not
  // one. Keep the last occurrence, so an explicit --lenses still wins on order.
  const seen = new Map();
  for (const dir of dirs) {
    seen.set(dir, true);
  }
  const uniqueDirs = [...seen.keys()];
  const sources = uniqueDirs.map(dir => ({ origin: dir, lenses: loadLenses(dir) }));
  if (sources.every(source => source.lenses.length === 0)) {
    fail(`no usable lens definitions found in: ${uniqueDirs.join(', ')}`);
  }
  return sources;
}

// Documentation files that live alongside lenses and are not lens attempts.
const NOT_A_LENS = /^(README|CONTRIBUTING|NOTES)\.md$/i;

// Returns whatever lenses the directory holds, possibly none. A source with no
// lenses is normal once sources layer — a project's own directory may hold only a
// README while the packaged lenses do the work. Failing here would make an empty
// local directory fatal; the combined set is what has to be non-empty, and
// lensSources checks that.
function loadLenses(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  const lenses = [];
  for (const file of files) {
    if (NOT_A_LENS.test(file)) {
      continue;
    }
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    const meta = parseFrontmatter(text);
    if (!meta?.name) {
      // Named, because a lens silently ignored for a malformed header is a
      // coverage hole that looks like a working roster.
      process.stderr.write(
        `crosscheck: ignoring ${file} — no frontmatter with a name\n`);
      continue;
    }
    const invariants = parseInvariants(text);
    const checked = validateLens({ ...meta, invariants });
    if (!checked.ok) {
      // A half-written invariant is worse than none: it produces a lens that
      // looks in the right place and declines to call what it finds a defect.
      fail(`lens ${meta.name} (${path}) is invalid:\n  - ` +
        checked.problems.join('\n  - '));
    }
    lenses.push({ ...meta, invariants, definition: text, definitionPath: path });
  }
  return lenses;
}

// Report one separator whatever the platform uses. git diff already speaks `/`,
// so without this a path-mode run on Windows routed, cached, and reported
// differently from the same run under --diff. Split on the platform separator
// rather than replacing every backslash: on POSIX a backslash is a legal
// character in a filename, and rewriting it would corrupt a real path.
const toPosix = path => sep === '/' ? path : path.split(sep).join('/');

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
    // Relative when the target is under cwd, absolute when it is not: a
    // ../../../ chain is harder to read than the full path, and the model has
    // to resolve whatever we print.
    const rel = relative(process.cwd(), path);
    out.push(toPosix(!rel || rel.startsWith('..') ? path : rel));
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
// Run git and return stdout. A failure here is fatal: a diff-scoped review that
// silently falls back to reviewing everything would cost far more than intended.
function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) {
    fail(`could not run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  }
  return result.stdout;
}

// A preflight command lets a project impose its own gate — data classification,
// a clean worktree, a branch policy — without crosscheck knowing what the rule
// is. Non-zero aborts before any model is called.
function runPreflight(commandLine) {
  process.stderr.write(`crosscheck: preflight ${commandLine}\n`);
  const result = spawnSync(commandLine, { shell: true, encoding: 'utf8' });
  if (result.error) {
    fail(`preflight could not run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.stderr.write(String(result.stdout ?? ''));
    process.stderr.write(String(result.stderr ?? ''));
    fail(`preflight failed (exit ${result.status}); nothing was dispatched`);
  }
}

// A disk-backed cache under .crosscheck/cache. Disabled entirely by --no-cache,
// in which case nothing is read or written.
function buildCache(options) {
  if (options['no-cache']) {
    return createCache();
  }
  const dir = resolve(options['cache-dir'] ?? '.crosscheck/cache');
  return createCache({
    read: key => {
      const path = join(dir, `${key}.json`);
      if (!existsSync(path)) {
        return null;
      }
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        // A corrupt entry is a miss, not a crash: the run should proceed and
        // simply pay for that lens again.
        return null;
      }
    },
    write: (key, entry) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${key}.json`), JSON.stringify(entry, null, 2));
    }
  });
}

// The lens's identity and its declared reasoning effort are published to the
// child as environment variables. crosscheck cannot know a given provider's flag
// for reasoning depth — `--exec` is an arbitrary command — so it states the
// intent and leaves the translation to the runner that knows its own CLI.
function execCommand(commandLine, meta = {}) {
  return ({ prompt }) => new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(commandLine, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CROSSCHECK_LENS: meta.lens ?? '',
        CROSSCHECK_EFFORT: meta.effort ?? '',
        CROSSCHECK_SCOPE: meta.scope ?? 'file'
      }
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

function report({ merged, suppressed, stale, refuted = [], untested = [] }) {
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
  // Always stated, including zero: a finding that vanished without a count is
  // indistinguishable from one that was never found.
  out.push('', `Refuted in verification: ${refuted.length}.`);
  if (untested.length) {
    // Surviving a refutation attempt and never facing one are different
    // standings for a finding, and only one of them is evidence.
    out.push('', `Kept without a test: ${untested.length} — the verifier ` +
      'returned no usable verdict, so these were neither refuted nor ' +
      'corroborated: ' +
      untested.map(f => `${f.file}:${f.line}`).join(', ') + '.');
  }
  if (merged.silent?.length) {
    const unsupported = merged.unsupported ?? [];
    const backed = merged.silent.filter(l => !unsupported.includes(l));
    if (backed.length) {
      out.push('', `Examined and found nothing: ${backed.join(', ')} — each ` +
        'stated the sites it checked, so this is a negative result rather ' +
        'than an absence.');
    }
    if (unsupported.length) {
      out.push('', `Reported nothing, coverage unstated: ${unsupported.join(', ')}` +
        '. For these, a clean file and a lens whose questions exceed its ' +
        'runner produce the same output. Counted, not read as clean.');
    }
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
      // More reports than lenses means nearby similar findings were collapsed;
      // say so and give the lines, or the entry understates what was reported.
      const collapsed = f.occurrences > f.lenses.length
        ? ` (${f.occurrences} reports across lines ${f.lines.join(', ')})`
        : '';
      out.push(`- [${who}] ${f.file}:${f.line}${collapsed} — ${f.issue}` +
        (f.fix ? ` — ${f.fix}` : ''));
    }
  }
  const participation = {
    total: (merged.silent?.length ?? 0) + new Set(
      merged.findings.flatMap(f => f.lenses ?? [])).size,
    silent: merged.silent ?? [],
    unsupported: merged.unsupported ?? []
  };
  out.push('', '## Panel verdict',
    `${panelVerdict(counts, participation)} — ${counts.BLOCK} block, ` +
    `${counts.FIX} fix, ` +
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

// Load the nearest config file, stopping at a repo root so a stray file in a
// parent directory cannot silently reshape the run. The path is always
// reported: a run configured by a file the user forgot about is the sort of
// invisible behaviour this tool rejects everywhere else.
function loadConfig(explicitPath) {
  const path = explicitPath ?? findConfig(process.cwd(), {
    exists: p => existsSync(p),
    isRoot: dir => existsSync(join(dir, '.git'))
  });
  if (!path) {
    return { config: {}, path: null };
  }
  if (!existsSync(path)) {
    fail(`no such config file: ${path}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
  const { config, problems } = validateConfig(raw, path);
  if (problems.length) {
    for (const problem of problems) {
      process.stderr.write(`crosscheck: ${problem}\n`);
    }
    fail('fix the config file, or pass --config to point elsewhere');
  }
  return { config, path };
}

const INIT_CONFIG = `{
  "// exec": "any command that takes a lens prompt on stdin and returns findings",
  "exec": "claude -p",
  "concurrency": 2,
  "// context": "lines of surrounding code given to a lens around each change",
  "context": 20
}
`;

const INIT_LENS_README = `# Project lenses

Markdown files here are added to the packaged lenses. A file whose \`name\`
matches a packaged lens overrides it, and the override is printed on every run.

Run \`crosscheck lenses\` to see what resolved and where each lens came from.

A lens needs five frontmatter keys and a body:

    ---
    name: house-rules
    summary: conventions this team actually enforces
    when: [**/*.{js,mjs}]
    owns: violations of our written conventions
    not-owns: correctness, security, architecture, usability
    ---

    # Lens: house-rules

    ...what to look for...

    Findings only, one per line: \`file:line — SEVERITY — issue — fix\`.
    SEVERITY is BLOCK, FIX, or CONSIDER. Reply exactly \`NO FINDINGS\` if none.

Nothing in this directory is published or uploaded by crosscheck. It is read off
disk at dispatch and goes nowhere else, so a lens here can encode conventions,
domain detail, or house rules that would make no sense upstream.
`;

const INIT_WORKFLOW = `name: crosscheck

on:
  pull_request:

permissions:
  contents: read
  # Required to upload SARIF to code scanning.
  security-events: write
  # Required to post the summary comment.
  pull-requests: write

concurrency:
  group: crosscheck-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # crosscheck reviews a diff, so it needs the base commit too.
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '22.x'

      # EDIT THIS STEP. crosscheck never talks to a model, so whatever your
      # \`exec\` command names has to exist on the runner. Nothing here is
      # installed for you, and a missing command fails every lens with ENOENT.
      #
      #   Claude Code:  npm i -g @anthropic-ai/claude-code   (exec: claude -p)
      #   llm:          pipx install llm                     (exec: llm -m ...)
      #   your own:     whatever installs it
      - name: Install the model CLI
        run: npm i -g @anthropic-ai/claude-code

      - name: Review the change
        env:
          # Whatever your exec command needs to authenticate. crosscheck reads no
          # credentials of its own.
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx @applesnort/crosscheck run \\
            --since origin/\${{ github.base_ref }} \\
            --sarif crosscheck.sarif \\
            --comment-file comment.md

      - name: Upload SARIF
        if: always() && hashFiles('crosscheck.sarif') != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: crosscheck.sarif

      - name: Post or update the summary comment
        if: always() && hashFiles('comment.md') != ''
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          # Edit our previous comment rather than stacking a new one.
          id=$(gh api "repos/\${{ github.repository }}/issues/\${{ github.event.number }}/comments" \\
                 --jq '[.[] | select(.body | contains("<!-- crosscheck:report -->"))] | last | .id // empty')
          if [ -n "$id" ]; then
            gh api --method PATCH "repos/\${{ github.repository }}/issues/comments/$id" \\
              -F body=@comment.md
          else
            gh api --method POST "repos/\${{ github.repository }}/issues/\${{ github.event.number }}/comments" \\
              -F body=@comment.md
          fi
`;

// Scaffold, without overwriting anything. A tool that silently replaces a config
// someone tuned is worse than one that refuses.
function initCommand(options) {
  const force = Boolean(options.force);
  const targets = [
    { path: '.crosscheckrc.json', content: INIT_CONFIG },
    { path: '.crosscheck/lenses/README.md', content: INIT_LENS_README },
    { path: '.github/workflows/crosscheck.yml', content: INIT_WORKFLOW }
  ];
  const written = [];
  const kept = [];
  for (const { path, content } of targets) {
    const full = resolve(path);
    if (existsSync(full) && !force) {
      kept.push(path);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    written.push(path);
  }
  const out = [];
  if (written.length) {
    out.push('Created:', ...written.map(p => `  ${p}`));
  }
  if (kept.length) {
    out.push('Left alone (already present; --force overwrites):',
      ...kept.map(p => `  ${p}`));
  }
  out.push('',
    'Next: set "exec" in .crosscheckrc.json to the command that runs your model,',
    'then try a dry run:',
    '',
    '  crosscheck run --diff --dry-run',
    '');
  process.stdout.write(out.join('\n'));
}

async function runCommand(cliOptions, positional) {
  const { config, path: configPath } = loadConfig(cliOptions.config);
  const options = mergeConfig(config, cliOptions);
  if (configPath) {
    process.stderr.write(`crosscheck: config ${configPath}\n`);
  }
  if (options.preflight) {
    runPreflight(options.preflight);
  }
  const diffMode = options.staged || options.since != null ||
    options.diff != null;
  if (positional.length === 0 && !diffMode) {
    fail('run needs a path to audit, or --diff / --staged / --since <ref>');
  }

  // Resolve the target first: a bad path or an empty diff is the more
  // fundamental error, and reporting a missing flag instead sends the user after
  // the wrong problem.
  let files;
  let rangesByFile = null;
  if (diffMode) {
    const cmd = diffCommand({
      diff: options.diff, staged: options.staged, since: options.since
    });
    process.stderr.write(`crosscheck: git ${cmd.join(' ')}\n`);
    const target = targetFromDiff(git(cmd));
    if (target.files.length === 0) {
      process.stderr.write(
        'crosscheck: the diff contains no reviewable changes — nothing to do\n');
      return;
    }
    files = target.files;
    // Widen to give a lens the surrounding code. A defect introduced by a change
    // is often only visible against the lines the change did not touch.
    const context = Number(options.context ?? 20);
    rangesByFile = Object.fromEntries(Object.entries(target.rangesByFile)
      .map(([file, ranges]) => [file, withContext(ranges, context)]));
  } else {
    files = collectFiles(positional);
  }
  if (!options.exec && !options['dry-run']) {
    fail("run needs --exec '<command>' (or --dry-run to see the prompts)");
  }
  const sources = lensSources(options.lenses,
    { includeBuiltin: !options['no-builtin'] });
  const { lenses, shadowed } = resolveLensSet(sources);
  const lensDir = sources.at(-1).origin;
  for (const s of shadowed) {
    process.stderr.write(
      `crosscheck: lens "${s.name}" from ${s.winner} overrides ${s.shadowedFrom}\n`);
  }
  // mergeConfig has already normalised these to arrays from either source.
  const overrides = { only: options.only, skip: options.skip };
  const { roster, skipped, unmatched } = planRun(lenses, files, overrides);

  process.stderr.write(
    `crosscheck: ${files.length} file(s), ${lenses.length} lens(es) from ` +
    `${sources.length} source(s)\n` +
    `  roster:  ${roster.map(l => l.name).join(', ') || '(none)'}\n` +
    (skipped.length
      ? skipped.map(s => `  skipped: ${s.lens} — ${s.reason}`).join('\n') + '\n'
      : '') +
    (unmatched.length
      ? `  UNREVIEWED: ${unmatched.length} file(s) matched no lens in the ` +
        `roster — ${unmatched.slice(0, 5).join(', ')}` +
        (unmatched.length > 5 ? `, +${unmatched.length - 5} more` : '') + '\n'
      : ''));

  if (roster.length === 0) {
    fail('no lens matched the target; nothing to run');
  }

  // Read every in-scope file once. The cache key already hashes these contents,
  // so this is the same read done for one more reason rather than a new cost.
  const embed = !options['no-embed'];
  const sourceText = embed
    ? Object.fromEntries(files.map(path => [
      path, existsSync(path) ? readFileSync(path, 'utf8') : null
    ]))
    : null;
  if (embed) {
    const unreadable = Object.entries(sourceText)
      .filter(([, content]) => content == null).map(([path]) => path);
    if (unreadable.length) {
      fail(`cannot read for review: ${unreadable.join(', ')}`);
    }
  }

  const promptOptions = {
    mixedCorpus: Boolean(options.mixed),
    rangesByFile,
    sources: sourceText,
    hunkContext: Number(options['hunk-context'] ?? 6)
  };

  // The cache key hashes file contents separately, so the prompt options it sees
  // carry only the switches that change the prompt's shape.
  const cacheablePromptOptions = {
    mixedCorpus: promptOptions.mixedCorpus,
    rangesByFile: promptOptions.rangesByFile,
    embed,
    hunkContext: promptOptions.hunkContext
  };

  if (options['dry-run']) {
    for (const job of promptsFor(roster, promptOptions)) {
      process.stdout.write(
        `\n===== ${job.lens} (${job.files.length} file(s)) =====\n${job.prompt}\n`);
    }
    return;
  }

  // Each lens may run under its own command, so dispatch resolves per lens
  // rather than sharing one executor.
  const byLens = new Map(roster.map(l => [l.name, l]));
  const dispatch = async ({ prompt, lens, files }) => {
    const commandLine = resolveExec(byLens.get(lens), options.exec);
    if (!commandLine) {
      throw new Error(
        `no exec for lens "${lens}" — set exec, or an exec map entry for it`);
    }
    const meta = byLens.get(lens);
    return execCommand(commandLine, {
      lens, effort: meta?.effort, scope: meta?.scope
    })({ prompt, lens, files });
  };

  // Two-stage triage. A cheap runner sees the whole target; the real panel then
  // sees only the files it flagged. Most code is clean, so most files never
  // reach the expensive runner at all.
  //
  // The saving has a cost, and it is not hidden: a defect the cheap pass misses
  // is a defect the expensive pass is never given the chance to find. Triage
  // trades recall for spend, which is why it is opt-in and why the narrowing is
  // always reported.
  let panelRoster = roster;
  if (options.triage) {
    process.stderr.write(`crosscheck: triage pass — ${options.triage}\n`);
    const triageDispatch = ({ prompt, lens, files }) => {
      const meta = byLens.get(lens);
      return execCommand(options.triage, {
        lens, effort: meta?.effort ?? 'low', scope: meta?.scope
      })({ prompt, lens, files });
    };
    const triaged = await runPanel({
      roster,
      skipped,
      exec: triageDispatch,
      concurrency: Number(options.concurrency ?? 4),
      promptOptions,
      onEstimate: line => process.stderr.write(`crosscheck: triage ${line}\n`),
      onLensStart: lens => process.stderr.write(`  · ${lens}\n`),
      onLensDone: (lens, r) => process.stderr.write(
        r.ok
          ? `  · ${lens} flagged ${r.findings} file-level hit(s)\n`
          : `  ✗ ${lens} did not complete in triage\n`)
    });
    for (const f of triaged.failures) {
      process.stderr.write(
        `crosscheck: triage lens ${f.lens} failed — ${f.reason}\n`);
    }
    panelRoster = narrowRosterToFindings(roster, triaged.reports);
    const kept = new Set(panelRoster.flatMap(l => l.files)).size;
    process.stderr.write(panelRoster.length === 0
      ? 'crosscheck: triage flagged nothing — the full panel did not run, so ' +
        'this verdict is the cheap pass\'s\n'
      : `crosscheck: triage narrowed the panel to ${kept} file(s) across ` +
        `${panelRoster.length} lens(es)\n`);
  }

  const cache = buildCache(options);
  const { reports, failures, dropped, cacheStats } = await runPanel({
    roster: panelRoster,
    skipped,
    exec: dispatch,
    concurrency: Number(options.concurrency ?? 4),
    promptOptions,
    cache: cache.enabled ? cache : null,
    cacheKeyFor: cache.enabled
      ? job => cacheKey({
        lens: job.lens,
        definition: byLens.get(job.lens)?.definition,
        files: job.files.map(path => ({
          path,
          content: existsSync(path) ? readFileSync(path, 'utf8') : ''
        })),
        promptOptions
      })
      : null,
    maxDispatches: options['max-dispatches'] == null
      ? null : Number(options['max-dispatches']),
    tokenBudget: options.budget == null ? null : Number(options.budget),
    onEstimate: line => process.stderr.write(`crosscheck: ${line}\n`),
    onLensStart: lens => process.stderr.write(`  → ${lens}\n`),
    onLensDone: (lens, r) => process.stderr.write(
      r.ok
        ? `  ✓ ${lens} (${r.findings} finding(s))${r.cached ? ' [cached]' : ''}\n`
        : `  ✗ ${lens} did not complete\n`)
  });

  // Both of these are coverage holes, and this tool states its holes.
  if (dropped.length) {
    process.stderr.write(
      `crosscheck: BUDGET REACHED — ${dropped.length} lens(es) not run: ` +
      `${dropped.map(d => d.lens).join(', ')}\n`);
  }
  if (cacheStats?.hits) {
    process.stderr.write(
      `crosscheck: ${cacheStats.hits} lens(es) served from cache\n`);
  }

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

  // Verification is on by default for BLOCK findings: false positives cost more
  // than misses, because a panel that cries wolf stops being read at all.
  let refuted = [];
  let untested = [];
  const verifyWanted = options['no-verify'] ? false : true;
  if (verifyWanted) {
    const candidates = merged.findings.filter(f =>
      options.verify ? true : f.severity === 'BLOCK');
    if (candidates.length > 0) {
      process.stderr.write(
        `crosscheck: verifying ${candidates.length} finding(s)\n`);
      const { verdicts, failures: verifyFailures } = await verifyFindings({
        findings: candidates,
        exec: execCommand(options.exec),
        concurrency: Number(options.concurrency ?? 4),
        onVerdict: (f, v) => process.stderr.write(
          `  ${v.refuted ? '✗ refuted'
            : v.tested === false ? '? not tested'
              : '✓ survived refutation'} ${f.file}:${f.line}\n`)
      });
      for (const f of verifyFailures) {
        // A verifier that did not run is not agreement; the finding stands.
        process.stderr.write(
          `crosscheck: verifier failed for ${f.finding} — ${f.reason}; ` +
          'the finding is kept\n');
      }
      const applied = applyVerdicts(merged.findings, verdicts);
      refuted = applied.refuted;
      untested = applied.untested;
      merged = { ...merged, findings: applied.findings };
      if (refuted.length) {
        process.stderr.write(
          `crosscheck: ${refuted.length} finding(s) refuted and removed\n`);
      }
      if (untested.length) {
        process.stderr.write(
          `crosscheck: ${untested.length} finding(s) kept without a test — ` +
          'the verifier returned no usable verdict for them\n');
      }
    }
  }
  let suppressed = [];
  let stale = [];
  const baseline = loadJson(options.baseline);
  if (baseline) {
    const filtered = filterAgainstBaseline(merged.findings, baseline);
    stale = staleBaselineEntries(baseline, merged.findings);
    suppressed = filtered.suppressed;
    merged = { ...merged, findings: filtered.findings };
  }

  process.stdout.write(report({ merged, suppressed, stale, refuted, untested }));

  if (options['comment-file']) {
    writeFileSync(options['comment-file'], buildComment({
      merged,
      refuted,
      suppressed,
      dropped,
      skipped,
      target: diffMode
        ? `${files.length} changed file(s)`
        : `${files.length} file(s)`,
      sarifPath: options.sarif ?? null
    }));
    process.stderr.write(`crosscheck: wrote ${options['comment-file']}\n`);
  }

  if (options.sarif) {
    writeFileSync(options.sarif, toSarifJson(merged, {
      lensMeta: Object.fromEntries(lenses.map(l => [l.name, l])),
      refuted
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

  if (command === 'init') {
    initCommand(options);
    return;
  }

  if (command === 'lenses') {
    const sources = lensSources(options.lenses,
      { includeBuiltin: !options['no-builtin'] });
    const { lenses, shadowed } = resolveLensSet(sources);
    const out = [`${lenses.length} lens(es) from ${sources.length} source(s):`];
    for (const lens of lenses) {
      out.push(`  ${lens.name.padEnd(16)} ${lens.origin}`);
      out.push(`    when: ${(lens.when ?? []).join(', ')}`);
    }
    for (const s of shadowed) {
      out.push(`  override: "${s.name}" from ${s.winner} shadows ${s.shadowedFrom}`);
    }
    process.stdout.write(out.join('\n') + '\n');
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
