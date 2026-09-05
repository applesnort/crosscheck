/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFindings, panelVerdict, countsBySeverity } from '../lib/merge.mjs';

const f = (file, line, severity = 'BLOCK') =>
  ({ file, line, severity, issue: 'i', fix: 'x' });
const spoke = (lens, findings) => ({ lens, findings, unparsed: [] });
const abstained = (lens) => ({ lens, findings: [], unparsed: [] });
const died = (lens) => ({ lens, findings: null, unparsed: [] });

test('a lens that reported nothing is counted apart from one that died', () => {
  const m = mergeFindings([
    spoke('check', [f('a.js', 1)]), abstained('taint'), died('ux')
  ]);
  assert.deepEqual(m.silent, ['taint']);
  assert.deepEqual(m.incomplete, ['ux']);
});

test('a lens that found something is never counted as silent', () => {
  const m = mergeFindings([spoke('check', [f('a.js', 1)])]);
  assert.deepEqual(m.silent, []);
});

test('an all-clear panel is still Ship when every lens actually reported', () => {
  const counts = countsBySeverity([]);
  assert.equal(panelVerdict(counts, { total: 2, silent: [] }), 'Ship');
});

test('Ship discloses how much of the panel abstained', () => {
  const v = panelVerdict(countsBySeverity([]),
    { total: 4, silent: ['architect', 'security-check', 'taint'] });
  assert.match(v, /3 of 4/);
  assert.match(v, /architect/);
  assert.doesNotMatch(v, /^Ship$/);
});

test('a panel where every lens abstained is not a pass at all', () => {
  const v = panelVerdict(countsBySeverity([]),
    { total: 3, silent: ['a', 'b', 'c'] });
  assert.match(v, /no signal|No signal/);
  assert.doesNotMatch(v, /^Ship/);
});

test('abstention never softens a real blocker', () => {
  const v = panelVerdict(countsBySeverity([f('a.js', 1, 'BLOCK')]),
    { total: 4, silent: ['taint'] });
  assert.match(v, /Do not ship/);
});

test('omitting participation keeps the previous wording', () => {
  assert.equal(panelVerdict(countsBySeverity([])), 'Ship');
});
