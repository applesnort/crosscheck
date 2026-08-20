/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// End-to-end tests that spawn the real CLI against a real directory.
//
// Every bug that reached a user so far lived in a seam between correct units:
// routing and glob-matching were each tested and never composed; the merge was
// tested with hand-written phrasing and never real lens prose; unreviewed files
// were nobody's unit. Unit tests cannot see those. Running the binary can.
//
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `.pathname`: the latter is a URL path, which keeps
// percent-escapes and prefixes a Windows drive letter with a slash.
const CLI = fileURLToPath(new URL('../bin/crosscheck.mjs', import.meta.url));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'crosscheck-smoke-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/app.js'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'src/view.jsx'), 'export const V = () => null;\n');
  // Matches no lens: the coverage hole the CLI must announce.
  writeFileSync(join(dir, 'src/styles.css'), 'body{}\n');
  return dir;
}

let stubCount = 0;

// A stand-in model. Written as a Node script rather than a shell one so the
// suite runs on Windows, where there is no /bin/sh and the execute bit chmod
// used to set does not exist. Returns the command line, since --exec takes one.
function stubExec(dir, body) {
  const path = join(dir, `stub-${stubCount++}.mjs`);
  writeFileSync(path, body);
  // Both quoted: either may sit under a path containing a space. Node runs a
  // Windows shell command as `cmd /d /s /c "<line>"`, which leaves inner quotes
  // alone, and /bin/sh reads them the same way.
  return `"${process.execPath}" "${path}"`;
}

// Reads the prompt on stdin and reports on the first file the prompt lists.
// `verdict` also answers as the verifier: the verification pass is on by
// default, so a stub that only knew how to report findings would see every one
// of them refuted.
const modelStub = verdict => `
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  prompt += chunk;
}
if (prompt.includes('REFUTE it')) {
  process.stdout.write('${verdict}\\n');
  process.exit(0);
}
const file = /^  - (\\S+)/m.exec(prompt)?.[1];
process.stdout.write(\`\${file}:1 — BLOCK — a stubbed defect — none needed\\n\`);
`;

const FINDING_STUB = modelStub('CONFIRMED — the trigger is reachable');

// A verifier that refutes everything, to prove findings are actually dropped.
const REFUTING_STUB = modelStub('REFUTED — the caller validates first');

function run(args, options = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options
  });
}

test('help runs and describes the run subcommand', () => {
  assert.match(run(['help']), /crosscheck run/);
});

test('dry-run routes real lenses over a real directory', () => {
  const dir = fixture();
  let stderr = '';
  const stdout = run(['run', join(dir, 'src'), '--dry-run'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  // stderr carries the roster; capture it via a second call that merges streams
  try {
    execFileSync(process.execPath, [CLI, 'run', join(dir, 'src'), '--dry-run'],
      { encoding: 'utf8' });
  } catch { /* not expected */ }
  assert.match(stdout, /BEGIN LENS DEFINITION/,
    'the shipped lenses must actually route to a plain .js/.jsx file');
  assert.doesNotMatch(stdout, /^when: \[/m,
    'frontmatter must not reach the model');
  // Separator-sensitive on purpose: a Windows run used to list `src\\app.js`,
  // which routed and reported differently from the same file under --diff.
  assert.ok(stdout.includes('src/app.js'), 'the target file is listed');
  assert.equal(typeof stderr, 'string');
});

test('a full run produces a report, and consensus survives the real pipeline', () => {
  const dir = fixture();
  const stub = stubExec(dir, FINDING_STUB);
  const out = run(['run', join(dir, 'src'), '--exec', stub]);
  const blocks = /## BLOCK \((\d+)\)/.exec(out);
  assert.ok(blocks && Number(blocks[1]) >= 1, 'findings are reported');
  assert.match(out, /CONSENSUS/,
    'lenses landing on one file must merge into a consensus finding');
  // The stub reports on each lens's own first file, and check/security/taint/
  // architect all lead with app.js — so those collapse to one entry.
  assert.equal((out.match(/src\/app\.js/g) ?? []).length, 1,
    'one merged entry for app.js, not one per lens');
  assert.match(out, /Panel verdict/);
});

test('SARIF written by the CLI is valid and carries lens metadata', () => {
  const dir = fixture();
  const stub = stubExec(dir, FINDING_STUB);
  const sarifPath = join(dir, 'out.sarif');
  run(['run', join(dir, 'src'), '--exec', stub, '--sarif', sarifPath]);
  const sarif = JSON.parse(readFileSync(sarifPath, 'utf8'));
  assert.equal(sarif.version, '2.1.0');
  assert.ok(sarif.runs[0].results.length >= 1);
  assert.ok(Object.keys(sarif.runs[0].results[0].partialFingerprints).length);
  const security = sarif.runs[0].tool.driver.rules
    .find(r => r.id === 'lens/security-check');
  assert.ok(security?.properties?.cites?.length,
    'default lens dir must still supply cites — this regressed once');
});

test('a file no lens reads is announced, not dropped', () => {
  const dir = fixture();
  // Both streams captured directly rather than merged by a shell redirect:
  // JSON.stringify doubles the backslashes in a Windows path, and cmd.exe is
  // not obliged to make sense of that.
  const result = spawnSync(process.execPath,
    [CLI, 'run', join(dir, 'src'), '--dry-run', '--only', 'check'],
    { encoding: 'utf8' });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.match(combined, /UNREVIEWED/);
  assert.match(combined, /styles\.css/);
});

test('a failing exec is surfaced and exits non-zero', () => {
  const dir = fixture();
  const stub = stubExec(dir, 'process.exit(7);\n');
  assert.throws(
    () => run(['run', join(dir, 'src'), '--exec', stub]),
    err => {
      assert.equal(err.status, 1, 'a partial panel must not exit 0');
      assert.match(String(err.stderr), /did not complete|exited 7/);
      return true;
    });
});

test('verification removes refuted findings and reports the count', () => {
  const dir = fixture();
  const stub = stubExec(dir, REFUTING_STUB);
  const out = run(['run', join(dir, 'src'), '--exec', stub]);
  assert.match(out, /## BLOCK \(0\)/, 'a refuted BLOCK must not survive');
  assert.match(out, /Refuted in verification: [1-9]/,
    'the count is stated, never a silent disappearance');
});

test('--no-verify keeps findings without a verification pass', () => {
  const dir = fixture();
  const stub = stubExec(dir, REFUTING_STUB);
  const out = run(['run', join(dir, 'src'), '--exec', stub, '--no-verify']);
  assert.match(out, /## BLOCK \([1-9]/, 'skipping verification keeps the finding');
  assert.match(out, /Refuted in verification: 0\./);
});

test('a nonexistent target fails loudly', () => {
  assert.throws(
    () => run(['run', '/definitely/not/here']),
    err => {
      assert.match(String(err.stderr), /no such path/);
      return true;
    });
});

test('run without --exec explains itself instead of doing nothing', () => {
  const dir = fixture();
  assert.throws(
    () => run(['run', join(dir, 'src')]),
    err => {
      assert.match(String(err.stderr), /--exec|--diff/);
      return true;
    });
});

test('--out saves raw lens text that report can rescore', () => {
  const dir = fixture();
  const stub = stubExec(dir, FINDING_STUB);
  const saved = join(dir, 'run.json');
  run(['run', join(dir, 'src'), '--exec', stub, '--out', saved]);
  const parsed = JSON.parse(readFileSync(saved, 'utf8'));
  assert.ok(parsed.length >= 1);
  assert.ok(parsed.some(r => typeof r.output === 'string' && r.output.length),
    'raw lens output is preserved for rescoring');
  assert.match(run(['report', '--in', saved]), /## BLOCK/);
});

test('init scaffolds a config, a lens directory, and a workflow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crosscheck-init-'));
  const out = execFileSync(process.execPath, [CLI, 'init'],
    { cwd: dir, encoding: 'utf8' });
  assert.match(out, /Created:/);
  for (const path of [
    '.crosscheckrc.json', '.crosscheck/lenses/README.md',
    '.github/workflows/crosscheck.yml'
  ]) {
    assert.ok(readFileSync(join(dir, path), 'utf8').length, `${path} written`);
  }
  const wf = readFileSync(join(dir, '.github/workflows/crosscheck.yml'), 'utf8');
  assert.match(wf, /fetch-depth: 0/, 'a diff review needs the base commit');
  assert.match(wf, /crosscheck:report/, 'the workflow edits its own comment');
  assert.match(wf, /security-events: write/, 'SARIF upload needs the permission');
});

test('init refuses to overwrite, and --force does', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crosscheck-init2-'));
  writeFileSync(join(dir, '.crosscheckrc.json'), '{"exec":"mine"}');
  const kept = execFileSync(process.execPath, [CLI, 'init'],
    { cwd: dir, encoding: 'utf8' });
  assert.match(kept, /Left alone/);
  assert.equal(
    JSON.parse(readFileSync(join(dir, '.crosscheckrc.json'), 'utf8')).exec,
    'mine', 'a tuned config must survive');
  execFileSync(process.execPath, [CLI, 'init', '--force'],
    { cwd: dir, encoding: 'utf8' });
  assert.notEqual(
    JSON.parse(readFileSync(join(dir, '.crosscheckrc.json'), 'utf8')).exec,
    'mine', '--force replaces it');
});

test('a scaffolded lens directory holding only a README still runs', () => {
  // init writes a README there. Treating a lens-less source as fatal would make
  // the scaffold unusable, which is how this was found.
  const dir = mkdtempSync(join(tmpdir(), 'crosscheck-init3-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 1;\n');
  execFileSync(process.execPath, [CLI, 'init'], { cwd: dir, encoding: 'utf8' });
  const out = execFileSync(process.execPath,
    [CLI, 'lenses'], { cwd: dir, encoding: 'utf8' });
  assert.match(out, /lens\(es\) from 2 source\(s\)/);
  assert.doesNotMatch(out, /ignoring README/, 'a README is not a failed lens');
});

test('a --comment-file body carries findings and the disclosures', () => {
  const dir = fixture();
  const stub = stubExec(dir, FINDING_STUB);
  const body = join(dir, 'comment.md');
  run(['run', join(dir, 'src'), '--exec', stub, '--comment-file', body]);
  const text = readFileSync(body, 'utf8');
  assert.match(text, /<!-- crosscheck:report -->/);
  assert.match(text, /## crosscheck/);
  assert.match(text, /Refuted in verification: \d/);
  assert.match(text, /Run details/);
});

test('the same lens directory named twice does not shadow itself', () => {
  // ./lenses is auto-detected, and running from that project also names it via
  // --lenses. Loading it twice made every lens shadow itself, which reads as a
  // configuration error that is not one.
  const dir = mkdtempSync(join(tmpdir(), 'crosscheck-dedupe-'));
  mkdirSync(join(dir, 'lenses'));
  writeFileSync(join(dir, 'lenses/house.md'), [
    '---', 'name: house', 'summary: s', 'when: [**/*.js]',
    'owns: o', 'not-owns: n', '---', '', '# Lens: house', '',
    'Findings only: file:line — SEVERITY — issue — fix. BLOCK, FIX, CONSIDER.',
    'Reply NO FINDINGS if none.'
  ].join('\n'));
  const out = execFileSync(process.execPath,
    [CLI, 'lenses', '--lenses', 'lenses'], { cwd: dir, encoding: 'utf8' });
  assert.doesNotMatch(out, /override: "house"/,
    'one directory cannot override itself');
  assert.equal((out.match(/^\s+house\s/gm) ?? []).length, 1,
    'the lens appears once');
});

test('the scaffolded workflow installs the model CLI it depends on', () => {
  // crosscheck never talks to a model, so the exec command must exist on the
  // runner. A workflow that sets an API key but never installs the CLI fails
  // every lens with ENOENT — which is what it did.
  const dir = mkdtempSync(join(tmpdir(), 'crosscheck-wf-'));
  execFileSync(process.execPath, [CLI, 'init'], { cwd: dir, encoding: 'utf8' });
  const wf = readFileSync(join(dir, '.github/workflows/crosscheck.yml'), 'utf8');
  assert.match(wf, /Install the model CLI/);
  assert.match(wf, /npm i -g @anthropic-ai\/claude-code/);
  assert.match(wf, /EDIT THIS STEP/, 'the choice must be visibly the user\'s');
  // Every permission the workflow's steps actually use must be declared.
  assert.match(wf, /security-events: write/, 'SARIF upload');
  assert.match(wf, /pull-requests: write/, 'the summary comment');
  assert.match(wf, /contents: read/, 'checkout');
});

// The packaged lens directory was resolved with `new URL(...).pathname`, which
// is not a filesystem path: it keeps percent-escapes, and on Windows it carries
// a leading slash before the drive letter (`/C:/...`). Every command that loads
// the built-in lenses died on an uncaught ENOENT. Windows was the platform it
// made unusable, but any install path containing a space failed the same way.
test('the built-in lenses load from an install path containing a space', () => {
  const parent = mkdtempSync(join(tmpdir(), 'crosscheck-space-'));
  const home = join(parent, 'my source');
  mkdirSync(home);
  for (const part of ['bin', 'lib', 'lenses']) {
    cpSync(new URL(`../${part}`, import.meta.url), join(home, part),
      { recursive: true });
  }
  // cwd is the space-free parent so no local ./lenses is auto-detected and the
  // packaged directory is the only source under test.
  const out = execFileSync(process.execPath, [join(home, 'bin/crosscheck.mjs'),
    'lenses'], { cwd: parent, encoding: 'utf8' });
  assert.match(out, /lens\(es\) from 1 source\(s\)/);
  assert.match(out, /security-check/, 'the packaged lenses are the ones loaded');
  assert.ok(out.includes('my source'),
    'the lens directory resolved to the real path, escapes decoded');
});

// `report` documents JSON on stdin as an alternative to --in, and nothing
// exercised it. readFileSync(0) is the implementation, and reading fd 0
// synchronously is the part of stdin handling most likely to differ on Windows.
test('report reads a run piped on stdin, not only --in', () => {
  const run = JSON.stringify([
    { lens: 'check', output: 'lib/a.js:41 — BLOCK — stale rows — guard it' },
    { lens: 'architect', output: 'lib/a.js:41 — BLOCK — stale rows — guard it' }
  ]);
  const result = spawnSync(process.execPath, [CLI, 'report'],
    { input: run, encoding: 'utf8' });
  assert.equal(result.status, 0, String(result.stderr));
  assert.match(result.stdout, /## BLOCK \(1\)/);
  assert.match(result.stdout, /CONSENSUS/, 'both lenses merge to one finding');
});
