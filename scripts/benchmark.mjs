#!/usr/bin/env node
/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Score released versions of crosscheck against a fixture with known defects,
// so a release has to demonstrate it improved something rather than assert it.
//
// Three things are held fixed, and each matters:
//
//   The model. A local model at temperature 0 with a fixed seed. A hosted model
//   can change under you between runs, which turns a regression suite into a
//   record of someone else's deploys.
//
//   The fixture. Frozen for the duration of a comparison. Adjusting ground
//   truth after seeing which defects a version bit is the move that makes a
//   benchmark meaningless, and PREREGISTERED.md rules it out by name.
//
//   The scorer. Every version's output is graded by THIS checkout's calibrate
//   against THIS checkout's expected.json. Letting each version grade itself
//   would measure changes to the scorer as if they were changes to the tool.
//
// Older versions built prompts that named files and expected the runner to open
// them. bench-runner.mjs does that when the prompt did not carry its source, so
// the comparison measures the tool rather than punishing old versions for a
// capability their contract assumed.
//
// Usage:
//   node scripts/benchmark.mjs --versions main,HEAD --model gemma4:latest
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const VERSIONS = (args.get('versions') ?? 'main,HEAD').split(',');
const MODEL = args.get('model') ?? 'gemma4:latest';
const CORPUS = args.get('corpus') ?? 'fixtures/calibration';
const OUT = args.get('out') ?? 'benchmarks/results.json';
const ROOT = resolve(process.cwd());

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const log = (m) => process.stderr.write(`benchmark: ${m}\n`);

function versionOf(ref) {
  try {
    return JSON.parse(git('show', `${ref}:package.json`)).version;
  } catch { return ref; }
}

// Each version runs in its own worktree so the comparison never depends on the
// state of the working tree it was launched from.
function runVersion(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-bench-'));
  const worktree = join(dir, 'wt');
  git('worktree', 'add', '--detach', worktree, ref);
  try {
    const runJson = join(dir, 'run.json');
    execFileSync('node', [
      join(worktree, 'bin/crosscheck.mjs'), 'run', join(CORPUS, 'src'),
      '--exec', `node ${join(ROOT, 'scripts/bench-runner.mjs')}`,
      '--no-cache', '--no-verify', '--concurrency', '1', '--out', runJson
    ], {
      cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BENCH_MODEL: MODEL }
    });
    return { runJson, dir, worktree };
  } catch (e) {
    // A version that cannot complete is a result, not a crash: record it.
    return { runJson: null, dir, worktree, error: e.stderr?.slice(-400) ?? String(e) };
  }
}

// Scored by this checkout, always. See the note at the top.
function score(runJson) {
  // calibrate exits non-zero when defects were missed. That is its verdict, not
  // a failure to produce one — the numbers are on stdout either way.
  let out;
  try {
    out = execFileSync('node', [
      join(ROOT, 'bin/crosscheck.mjs'), 'calibrate',
      '--in', runJson, '--expected', join(ROOT, CORPUS, 'expected.json')
    ], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    out = e.stdout ?? '';
    if (!out) {
      throw e;
    }
  }
  const num = (re) => {
    const m = re.exec(out);
    return m ? Number(m[1]) : null;
  };
  return {
    planted: num(/defects planted:\s+(\d+)/),
    found: num(/defects found:\s+(\d+)/),
    recall: num(/recall ([\d.]+)%/),
    reported: num(/findings reported:\s+(\d+)/),
    precision: num(/precision ([\d.]+)%/),
    falsePositives: num(/false positives:\s+(\d+)/),
    raw: out
  };
}

mkdirSync(join(ROOT, 'benchmarks'), { recursive: true });
const results = {
  corpus: CORPUS, model: MODEL, scorer: versionOf('HEAD'),
  generated: new Date().toISOString().slice(0, 10),
  note: 'One fixed local model at temperature 0, one frozen fixture, one ' +
    'scorer. Versions before 0.9.0 name files rather than embedding them and ' +
    'are run with a file-reading runner, which is the capability their ' +
    'contract assumed.',
  runs: []
};

for (const ref of VERSIONS) {
  const version = versionOf(ref);
  log(`running ${ref} (v${version})`);
  const { runJson, dir, worktree, error } = runVersion(ref);
  if (!runJson) {
    log(`  ${ref} did not complete`);
    results.runs.push({ ref, version, completed: false, error });
  } else {
    const s = score(runJson);
    log(`  recall ${s.recall}%  precision ${s.precision}%  fp ${s.falsePositives}`);
    results.runs.push({ ref, version, completed: true, ...s });
  }
  try {
    git('worktree', 'remove', '--force', worktree);
  } catch { /* the worktree is in a temp dir either way */ }
  rmSync(dir, { recursive: true, force: true });
}

writeFileSync(join(ROOT, OUT), JSON.stringify(results, null, 2) + '\n');
log(`wrote ${OUT}`);

const rows = results.runs.map(r => r.completed
  ? `| ${r.version} | ${r.recall}% | ${r.precision}% | ${r.found}/${r.planted} | ${r.falsePositives} |`
  : `| ${r.version} | did not complete | | | |`);
process.stdout.write(
  `| version | recall | precision | defects found | false positives |\n` +
  `|---|---|---|---|---|\n${rows.join('\n')}\n`);
