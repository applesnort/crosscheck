/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrowRosterToFindings } from '../lib/run.mjs';

const roster = [
  { name: 'check', files: ['a.js', 'b.js'] },
  { name: 'taint', files: ['a.js', 'c.js'] },
  { name: 'ux', files: ['d.jsx'] }
];

const report = (lens, files) => ({
  lens, findings: files.map(file => ({ file, line: 1, severity: 'BLOCK' }))
});

test('only files the cheap pass flagged survive', () => {
  const narrowed = narrowRosterToFindings(roster, [report('check', ['a.js'])]);
  assert.deepEqual(narrowed.map(l => l.name), ['check', 'taint']);
  assert.deepEqual(narrowed[0].files, ['a.js']);
  assert.deepEqual(narrowed[1].files, ['a.js']);
});

test('a lens with nothing left is dropped from the second pass', () => {
  const narrowed = narrowRosterToFindings(roster, [report('check', ['d.jsx'])]);
  assert.deepEqual(narrowed.map(l => l.name), ['ux']);
});

test('no findings means no second pass at all', () => {
  assert.deepEqual(narrowRosterToFindings(roster, [report('check', [])]), []);
});

test('a lens that died is not read as a clean file', () => {
  // findings: null marks a lens that did not complete. Treating that as "found
  // nothing" would quietly exclude its files from the expensive pass, which is
  // the one place a real defect would then be missed entirely.
  const narrowed = narrowRosterToFindings(roster,
    [{ lens: 'check', findings: null }]);
  assert.deepEqual(narrowed.map(l => l.name), ['check', 'taint', 'ux']);
});

test('every lens keeps its own routing — triage narrows files, not the roster', () => {
  const narrowed = narrowRosterToFindings(roster,
    [report('check', ['a.js', 'b.js', 'c.js', 'd.jsx'])]);
  assert.deepEqual(narrowed.map(l => l.name), ['check', 'taint', 'ux']);
  assert.deepEqual(narrowed[0].files, ['a.js', 'b.js']);
});
