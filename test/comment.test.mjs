/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMMENT_MARKER,
  buildComment,
  findOwnComment,
  isOwnComment
} from '../lib/comment.mjs';
import { mergeFindings } from '../lib/merge.mjs';

const at = (file, line, severity, issue, fix = 'fix it') =>
  ({ file, line, severity, issue, fix });
const merge = reports => mergeFindings(reports);

test('a clean run says so plainly', () => {
  const body = buildComment({ merged: merge([{ lens: 'check', findings: [] }]) });
  assert.match(body, /No findings\./);
  assert.match(body, /## crosscheck/);
});

test('findings are grouped by severity with counts', () => {
  const body = buildComment({
    merged: merge([{ lens: 'check', findings: [
      at('a.js', 1, 'blocker', 'bad thing'),
      at('a.js', 9, 'fix', 'lesser thing'),
      at('a.js', 20, 'nit', 'minor thing')
    ] }])
  });
  assert.match(body, /\*\*1 block · 1 fix · 1 consider\*\*/);
  assert.match(body, /BLOCK \(1\)/);
  assert.match(body, /`a\.js:1` — bad thing/);
  assert.match(body, /\*\*Fix:\*\* fix it/);
});

test('agreement between lenses is called out', () => {
  const shared = at('a.js', 5, 'blocker', 'the same defect');
  const body = buildComment({
    merged: merge([
      { lens: 'check', findings: [shared] },
      { lens: 'taint', findings: [at('a.js', 5, 'blocker', 'The same defect!')] }
    ])
  });
  assert.match(body, /agreed by more than one lens/);
  assert.match(body, /\*\*check \+ taint\*\* agreed/);
});

test('a long list is truncated and says how many are hidden', () => {
  // Spread far apart and distinctly worded, so these stay 14 findings rather
  // than chaining into one cluster.
  const findings = Array.from({ length: 14 }, (_, i) =>
    at(`file${i}.js`, i * 40 + 1, 'blocker', `distinct problem ${'x'.repeat(i + 3)}`));
  const merged = merge([{ lens: 'check', findings }]);
  assert.equal(merged.findings.length, 14, 'the fixture must not self-merge');
  const body = buildComment({ merged, limitPerSeverity: 10 });
  assert.match(body, /and 4 more BLOCK finding\(s\) not shown/,
    'a truncated list that does not say so reads as the whole list');
});

test('a collapsed cluster is visible in the comment', () => {
  const findings = Array.from({ length: 6 }, (_, i) =>
    at('a.js', i + 1, 'blocker', 'unescaped value written to the response'));
  const body = buildComment({ merged: merge([{ lens: 'check', findings }]) });
  assert.match(body, /6 reports across lines 1, 2, 3, 4, 5, 6/);
});

test('the refuted count is always present, including zero', () => {
  const clean = buildComment({ merged: merge([{ lens: 'check', findings: [] }]) });
  assert.match(clean, /Refuted in verification: 0/);
  const some = buildComment({
    merged: merge([{ lens: 'check', findings: [] }]),
    refuted: [{ file: 'a.js', line: 1 }, { file: 'b.js', line: 2 }]
  });
  assert.match(some, /Refuted in verification: 2/);
});

test('every coverage hole is disclosed in the comment', () => {
  const body = buildComment({
    merged: { findings: [], incomplete: ['ux'], unparsed: [] },
    dropped: [{ lens: 'taint' }],
    suppressed: [{ file: 'a.js' }],
    skipped: [{ lens: 'architect', reason: 'nothing in scope matches **/*.sql' }]
  });
  assert.match(body, /Did not complete: ux/);
  assert.match(body, /Budget reached.*taint/);
  assert.match(body, /Suppressed by baseline: 1/);
  assert.match(body, /Not applicable to these files: architect/);
});

test('a lens excluded by request is not called irrelevant', () => {
  const body = buildComment({
    merged: { findings: [], incomplete: [], unparsed: [] },
    skipped: [
      { lens: 'ux', reason: 'nothing in scope matches **/*.jsx' },
      { lens: 'taint', reason: 'excluded by --only' }
    ]
  });
  assert.match(body, /Not applicable to these files: ux/);
  assert.match(body, /Excluded by request: taint/);
  assert.doesNotMatch(body, /Not applicable to these files: [^\n]*taint/);
});

test('the target and SARIF path appear when supplied', () => {
  const body = buildComment({
    merged: merge([{ lens: 'check', findings: [] }]),
    target: '12 changed file(s) since origin/main',
    sarifPath: 'crosscheck.sarif'
  });
  assert.match(body, /Reviewed 12 changed file\(s\) since origin\/main/);
  assert.match(body, /crosscheck\.sarif/);
  assert.match(body, /code scanning/);
});

// --- identifying our own comment, so runs edit rather than stack ---

test('every comment carries the marker', () => {
  const body = buildComment({ merged: merge([{ lens: 'check', findings: [] }]) });
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.equal(isOwnComment(body), true);
});

test('someone else\'s comment is not ours', () => {
  assert.equal(isOwnComment('Looks good to me!'), false);
  assert.equal(isOwnComment(''), false);
  assert.equal(isOwnComment(undefined), false);
});

test('the most recent of our comments is the one to update', () => {
  const comments = [
    { id: 1, body: 'a human comment' },
    { id: 2, body: `${COMMENT_MARKER}\nold run` },
    { id: 3, body: 'another human' },
    { id: 4, body: `${COMMENT_MARKER}\nnewer run` }
  ];
  assert.equal(findOwnComment(comments), 4);
});

test('with no comment of ours, a new one is created', () => {
  assert.equal(findOwnComment([{ id: 1, body: 'hello' }]), null);
  assert.equal(findOwnComment([]), null);
  assert.equal(findOwnComment(undefined), null);
});
