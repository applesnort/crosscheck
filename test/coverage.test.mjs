/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLensOutput } from '../lib/parse.mjs';

test('coverage lines are captured, not counted as unparsed noise', () => {
  const r = parseLensOutput(
    'COVERAGE: I1 — examined 2 functions returning secrets\n' +
    'COVERAGE: I3 — examined 8 exported functions for caller identity\n' +
    'NO FINDINGS');
  assert.deepEqual(r.unparsed, []);
  assert.equal(r.coverage.length, 2);
  assert.equal(r.coverage[0].id, 'I1');
  assert.match(r.coverage[0].examined, /2 functions/);
});

test('an abstention with coverage is distinguishable from a bare one', () => {
  const supported = parseLensOutput('COVERAGE: scope — read all 8\nNO FINDINGS');
  const bare = parseLensOutput('NO FINDINGS');
  assert.equal(supported.findings.length, 0);
  assert.equal(bare.findings.length, 0);
  assert.equal(supported.coverage.length, 1);
  assert.equal(bare.coverage.length, 0);
});

test('coverage alongside findings is still captured', () => {
  const r = parseLensOutput(
    'COVERAGE: I1 — examined 2 sites\n' +
    'a.js:4 — BLOCK — bad — fix it');
  assert.equal(r.findings.length, 1);
  assert.equal(r.coverage.length, 1);
  assert.deepEqual(r.unparsed, []);
});

test('a malformed coverage line is unparsed, not silently dropped', () => {
  const r = parseLensOutput('COVERAGE:\nNO FINDINGS');
  assert.equal(r.coverage.length, 0);
  assert.equal(r.unparsed.length, 1);
});

import { mergeFindings, panelVerdict, countsBySeverity } from '../lib/merge.mjs';

const abstain = (lens, coverage = []) => ({ lens, findings: [], unparsed: [], coverage });

test('an abstention backed by coverage is separated from a bare one', () => {
  const m = mergeFindings([
    abstain('taint', [{ id: 'scope', examined: 'all 8 call sites' }]),
    abstain('architect')
  ]);
  assert.deepEqual(m.silent.sort(), ['architect', 'taint']);
  assert.deepEqual(m.unsupported, ['architect'],
    'only the abstention that showed no work is unsupported');
});

test('a panel abstaining entirely without coverage is not a pass', () => {
  const v = panelVerdict(countsBySeverity([]),
    { total: 2, silent: ['a', 'b'], unsupported: ['a', 'b'] });
  assert.match(v, /No signal/);
});

test('a panel that abstained but showed its work says so differently', () => {
  const v = panelVerdict(countsBySeverity([]),
    { total: 2, silent: ['a', 'b'], unsupported: [] });
  assert.doesNotMatch(v, /No signal/);
  assert.match(v, /coverage|examined/i);
});
