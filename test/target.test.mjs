/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  changedFiles,
  diffCommand,
  formatRanges,
  mergeRanges,
  parseDiff,
  targetFromDiff,
  withContext
} from '../lib/target.mjs';

// Recorded from `git diff --unified=0`.
const DIFF = [
  'diff --git a/lib/a.js b/lib/a.js',
  'index 1111111..2222222 100644',
  '--- a/lib/a.js',
  '+++ b/lib/a.js',
  '@@ -4,0 +5,3 @@ export function f() {',
  '+  const x = 1;',
  '+  const y = 2;',
  '+  return x + y;',
  '@@ -20,2 +24,1 @@ export function g() {',
  '-  old();',
  '-  older();',
  '+  fresh();',
  'diff --git a/lib/b.js b/lib/b.js',
  '--- a/lib/b.js',
  '+++ b/lib/b.js',
  '@@ -1 +1 @@',
  '-const a = 1;',
  '+const a = 2;',
  ''
].join('\n');

test('parses files and new-side line ranges from a unified diff', () => {
  const parsed = parseDiff(DIFF);
  assert.deepEqual(parsed.map(p => p.file), ['lib/a.js', 'lib/b.js']);
  assert.deepEqual(parsed[0].ranges, [[5, 7], [24, 24]]);
  assert.deepEqual(parsed[1].ranges, [[1, 1]]);
});

test('a hunk header with no count means a single line', () => {
  const parsed = parseDiff([
    '--- a/x.js', '+++ b/x.js', '@@ -3 +3 @@', '-a', '+b'
  ].join('\n'));
  assert.deepEqual(parsed[0].ranges, [[3, 3]]);
});

test('a pure deletion contributes no reviewable range', () => {
  // +9,0 means nothing was added at that point.
  const parsed = parseDiff([
    '--- a/x.js', '+++ b/x.js', '@@ -9,2 +9,0 @@', '-gone();', '-also();'
  ].join('\n'));
  assert.deepEqual(parsed[0].ranges, []);
});

test('a deleted file is excluded — there is nothing left to review', () => {
  const parsed = parseDiff([
    'diff --git a/gone.js b/gone.js',
    '--- a/gone.js',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-a', '-b', '-c'
  ].join('\n'));
  assert.deepEqual(parsed, []);
});

test('a renamed file is tracked under its new path', () => {
  const parsed = parseDiff([
    'diff --git a/old.js b/new.js',
    'similarity index 95%',
    'rename from old.js',
    'rename to new.js',
    '--- a/old.js',
    '+++ b/new.js',
    '@@ -2,0 +3,1 @@',
    '+added();'
  ].join('\n'));
  assert.deepEqual(parsed.map(p => p.file), ['new.js']);
  assert.deepEqual(parsed[0].ranges, [[3, 3]]);
});

test('a new file is included with its full added range', () => {
  const parsed = parseDiff([
    'diff --git a/new.js b/new.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.js',
    '@@ -0,0 +1,4 @@',
    '+a', '+b', '+c', '+d'
  ].join('\n'));
  assert.deepEqual(parsed[0].file, 'new.js');
  assert.deepEqual(parsed[0].ranges, [[1, 4]]);
});

test('an empty diff yields no target rather than throwing', () => {
  assert.deepEqual(parseDiff(''), []);
  assert.deepEqual(parseDiff(undefined), []);
  assert.deepEqual(changedFiles(''), []);
});

// --- ranges ---

test('adjacent and overlapping ranges merge', () => {
  assert.deepEqual(mergeRanges([[1, 3], [4, 6]]), [[1, 6]], 'adjacent');
  assert.deepEqual(mergeRanges([[1, 5], [3, 8]]), [[1, 8]], 'overlapping');
  assert.deepEqual(mergeRanges([[1, 2], [10, 12]]), [[1, 2], [10, 12]], 'distant');
});

test('merging is order-independent', () => {
  assert.deepEqual(mergeRanges([[10, 12], [1, 3]]), [[1, 3], [10, 12]]);
});

test('context widens ranges and never goes below line 1', () => {
  assert.deepEqual(withContext([[5, 7]], 4), [[1, 11]]);
  assert.deepEqual(withContext([[30, 30]], 5), [[25, 35]]);
});

test('context respects a file length', () => {
  assert.deepEqual(withContext([[8, 9]], 10, 12), [[1, 12]]);
});

test('context merges ranges that widening brings together', () => {
  assert.deepEqual(withContext([[5, 5], [15, 15]], 6), [[1, 21]],
    'two changes 10 lines apart become one region at 6 lines of context');
});

test('ranges format for a prompt', () => {
  assert.equal(formatRanges([[5, 7], [24, 24]]), '5-7, 24');
  assert.equal(formatRanges([]), '');
});

// --- target assembly ---

test('targetFromDiff returns files and their ranges', () => {
  const { files, rangesByFile } = targetFromDiff(DIFF);
  assert.deepEqual(files, ['lib/a.js', 'lib/b.js']);
  assert.deepEqual(rangesByFile['lib/a.js'], [[5, 7], [24, 24]]);
});

test('a filter can exclude paths from the diff target', () => {
  const { files } = targetFromDiff(DIFF, { filter: f => f.endsWith('b.js') });
  assert.deepEqual(files, ['lib/b.js']);
});

test('files whose only change was a deletion are dropped', () => {
  const { files } = targetFromDiff([
    '--- a/x.js', '+++ b/x.js', '@@ -9,2 +9,0 @@', '-a', '-b'
  ].join('\n'));
  assert.deepEqual(files, []);
});

// --- git command selection ---

test('each targeting mode produces the expected git command', () => {
  assert.deepEqual(diffCommand({ staged: true }).slice(-1), ['--cached']);
  assert.deepEqual(diffCommand({ since: 'origin/main' }).slice(-1),
    ['origin/main...HEAD']);
  assert.deepEqual(diffCommand({ diff: 'v1.0' }).slice(-1), ['v1.0...HEAD']);
  assert.deepEqual(diffCommand({ diff: true }).slice(-1), ['HEAD'],
    'bare --diff reviews everything uncommitted');
  assert.deepEqual(diffCommand({}).slice(-1), ['HEAD']);
});

test('every diff command suppresses colour and external diff tools', () => {
  // ANSI codes would break hunk parsing; an ext-diff would replace the format.
  for (const options of [{}, { staged: true }, { since: 'x' }, { diff: 'y' }]) {
    const cmd = diffCommand(options);
    assert.ok(cmd.includes('--no-color'), JSON.stringify(options));
    assert.ok(cmd.includes('--no-ext-diff'), JSON.stringify(options));
    assert.ok(cmd.includes('--unified=0'), JSON.stringify(options));
  }
});

test('staged wins over since, which wins over diff', () => {
  assert.ok(diffCommand({ staged: true, since: 'a', diff: 'b' })
    .includes('--cached'));
  assert.ok(diffCommand({ since: 'a', diff: 'b' }).includes('a...HEAD'));
});
