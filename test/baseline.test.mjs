/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BASELINE_VERSION,
  baselineFingerprints,
  filterAgainstBaseline,
  staleBaselineEntries,
  toBaseline
} from '../lib/baseline.mjs';
import { mergeFindings } from '../lib/merge.mjs';

const at = (file, line, severity, issue) =>
  ({ file, line, severity, issue, fix: 'fix it' });

const findingsFrom = reports => mergeFindings(reports).findings;

const legacy = findingsFrom([{ lens: 'check', findings: [
  at('lib/old.js', 10, 'blocker', 'pre-existing one'),
  at('lib/old.js', 20, 'fix', 'pre-existing two')
] }]);

test('a baseline records fingerprints and is sorted for stable diffs', () => {
  const baseline = toBaseline(findingsFrom([{ lens: 'check', findings: [
    at('lib/z.js', 1, 'fix', 'z'),
    at('lib/a.js', 5, 'fix', 'a5'),
    at('lib/a.js', 2, 'fix', 'a2')
  ] }]));
  assert.equal(baseline.version, BASELINE_VERSION);
  assert.equal(baseline.count, 3);
  assert.deepEqual(baseline.findings.map(f => `${f.file}:${f.line}`),
    ['lib/a.js:2', 'lib/a.js:5', 'lib/z.js:1']);
});

test('baseline entries keep readable context for human review', () => {
  const [entry] = toBaseline(legacy).findings;
  assert.ok(entry.issue, 'issue text is retained');
  assert.ok(Array.isArray(entry.lenses));
  assert.match(entry.fingerprint, /^[0-9a-f]{16}$/);
});

test('known findings are suppressed and counted, never dropped in silence', () => {
  const baseline = toBaseline(legacy);
  const run = findingsFrom([{ lens: 'check', findings: [
    at('lib/old.js', 10, 'blocker', 'pre-existing one'),
    at('lib/new.js', 3, 'blocker', 'introduced by this change')
  ] }]);
  const { findings, suppressed } = filterAgainstBaseline(run, baseline);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'lib/new.js');
  assert.equal(suppressed.length, 1);
  assert.equal(suppressed[0].file, 'lib/old.js');
});

test('an empty or absent baseline suppresses nothing', () => {
  const run = findingsFrom([{ lens: 'check', findings: [
    at('lib/a.js', 1, 'fix', 'x')
  ] }]);
  for (const baseline of [null, undefined, toBaseline([])]) {
    const r = filterAgainstBaseline(run, baseline);
    assert.equal(r.findings.length, 1);
    assert.deepEqual(r.suppressed, []);
  }
});

test('severity and fix changes do not defeat baseline matching', () => {
  const baseline = toBaseline(findingsFrom([{ lens: 'check', findings: [
    at('lib/a.js', 7, 'nit', 'the same issue')
  ] }]));
  const rerun = findingsFrom([{ lens: 'security-check', findings: [
    { file: 'lib/a.js', line: 7, severity: 'BLOCK', issue: 'the same issue',
      fix: 'a different fix' }
  ] }]);
  assert.equal(filterAgainstBaseline(rerun, baseline).suppressed.length, 1);
});

test('a moved finding is reported as new, because its location changed', () => {
  const baseline = toBaseline(legacy);
  const moved = findingsFrom([{ lens: 'check', findings: [
    at('lib/old.js', 11, 'blocker', 'pre-existing one')
  ] }]);
  assert.equal(filterAgainstBaseline(moved, baseline).findings.length, 1);
});

test('an unsupported baseline version throws instead of silently matching none', () => {
  assert.throws(
    () => baselineFingerprints({ version: 99, findings: [] }),
    /Unsupported baseline version 99/);
});

test('stale entries expose either a fix or a lens that stopped running', () => {
  const baseline = toBaseline(legacy);
  const run = findingsFrom([{ lens: 'check', findings: [
    at('lib/old.js', 10, 'blocker', 'pre-existing one')
  ] }]);
  const stale = staleBaselineEntries(baseline, run);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].line, 20);
});

test('no stale entries when every baseline finding still appears', () => {
  const baseline = toBaseline(legacy);
  assert.deepEqual(staleBaselineEntries(baseline, legacy), []);
});
