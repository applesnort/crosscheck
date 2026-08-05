/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  findDefect,
  formatScore,
  lensIsCredited,
  matchesDefect,
  score
} from '../lib/calibrate.mjs';
import { mergeFindings } from '../lib/merge.mjs';

const EXPECTED = JSON.parse(readFileSync(
  new URL('../fixtures/calibration/expected.json', import.meta.url), 'utf8'));
const FILE = 'fixtures/calibration/src/session.js';

const byId = id => EXPECTED.defects.find(d => d.id === id);
const at = (line, severity, issue) => ({ file: FILE, line, severity, issue });
const merge = reports => mergeFindings(reports).findings;

test('the fixture does not leak its own answers', () => {
  // A fixture that marks where its defects are measures whether a lens can read
  // comments, not whether it can find defects. The file may say that it contains
  // planted defects; it may not say which lines they are on.
  const source = readFileSync(
    new URL('../fixtures/calibration/src/session.js', import.meta.url), 'utf8');
  const lines = source.split('\n');

  for (const d of EXPECTED.defects) {
    assert.doesNotMatch(source, new RegExp(d.id),
      `defect id ${d.id} must not appear in the fixture source`);
    const [lo, hi] = d.span;
    // Look a couple of lines above the span too: a marker comment usually sits
    // immediately before the code it describes.
    const window = lines.slice(Math.max(0, lo - 3), hi).join('\n');
    assert.doesNotMatch(window, /\b(PLANTED|DEFECT|BUG|VULN|FIXME|XXX|INTENTIONAL)\b/i,
      `${d.id}: a marker comment near lines ${lo}-${hi} gives the answer away`);
  }

  // The decoys may explain why they are correct — that is the reasoning a lens
  // has to weigh, not a location tag — but they must not name a severity scale.
  assert.doesNotMatch(source, /\b(BLOCK|CONSIDER)\b/,
    'the fixture must not carry the panel severity vocabulary');
});

test('decoys sit below the declared clean line, so precision is measurable', () => {
  assert.ok(EXPECTED.decoys.items.length >= 5, 'enough decoys to catch overreach');
  for (const decoy of EXPECTED.decoys.items) {
    assert.ok(decoy.line >= EXPECTED.decoys.cleanFrom,
      `decoy at ${decoy.line} must be at or below line ${EXPECTED.decoys.cleanFrom}`);
    assert.ok(decoy.why, 'each decoy explains why it is correct');
  }
  for (const d of EXPECTED.defects) {
    assert.ok(d.span[1] < EXPECTED.decoys.cleanFrom,
      `defect ${d.id} must not overlap the clean region`);
  }
});

test('the fixture ground truth is internally consistent', () => {
  assert.ok(EXPECTED.defects.length >= 5, 'enough defects to measure anything');
  for (const d of EXPECTED.defects) {
    assert.ok(d.id && d.file && d.severity && d.expectedBy, `${d.id} complete`);
    const [lo, hi] = d.span;
    assert.ok(lo <= d.line && d.line <= hi,
      `${d.id}: line ${d.line} must fall inside span ${lo}-${hi}`);
    assert.ok(!(d.alsoAcceptedBy ?? []).includes(d.expectedBy),
      `${d.id}: owner must not be repeated in alsoAcceptedBy`);
  }
  const ids = EXPECTED.defects.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length, 'defect ids are unique');
});

test('planted defect lines still point at the intended statements', () => {
  const source = readFileSync(
    new URL('../fixtures/calibration/src/session.js', import.meta.url), 'utf8')
    .split('\n');
  const expectations = {
    'predictable-token': /Date\.now\(\) \/ 1000/,
    'timing-unsafe-compare': /return supplied === stored/,
    'expires-as-number': /expires: Date\.now\(\)/,
    'unguarded-expiry-read': /record\.session\.token === token/,
    'falsy-quota-reset': /record\.session\.quota \|\| fallback/,
    'missing-ownership-check': /return record\.session;/,
    'swallowed-error': /return \[\];/
  };
  for (const [id, pattern] of Object.entries(expectations)) {
    const defect = byId(id);
    assert.match(source[defect.line - 1], pattern,
      `${id} at line ${defect.line} — fixture and ground truth have drifted`);
  }
});

test('a finding anywhere in the defect span matches', () => {
  const defect = byId('missing-ownership-check');
  const [lo, hi] = defect.span;
  assert.equal(matchesDefect(at(lo, 'BLOCK', 'x'), defect), true);
  assert.equal(matchesDefect(at(hi, 'BLOCK', 'x'), defect), true);
  assert.equal(matchesDefect(at(hi + 1, 'BLOCK', 'x'), defect), false);
  assert.equal(matchesDefect(at(lo - 1, 'BLOCK', 'x'), defect), false);
});

test('a finding in another file never matches', () => {
  assert.equal(
    matchesDefect({ file: 'other.js', line: 60 }, byId('missing-ownership-check')),
    false);
  assert.equal(findDefect({ file: 'other.js', line: 60 }, EXPECTED.defects), null);
});

test('credit goes to the owner and to explicitly accepted lenses only', () => {
  const defect = byId('unguarded-expiry-read');
  assert.equal(lensIsCredited('check', defect), true, 'owner');
  assert.equal(lensIsCredited('architect', defect), true, 'also accepted');
  assert.equal(lensIsCredited('ux', defect), false);
});

test('a perfect run scores full recall and precision', () => {
  const findings = merge(EXPECTED.defects.map(d => ({
    lens: d.expectedBy,
    findings: [at(d.line, d.severity, d.summary)]
  })));
  const result = score(findings, EXPECTED);
  assert.equal(result.recall, 1);
  assert.equal(result.precision, 1);
  assert.equal(result.falsePositives, 0);
  assert.deepEqual(result.missed, []);
  assert.deepEqual(result.severityMismatches, []);
});

test('a missed defect is named along with the lens that should have caught it', () => {
  const findings = merge(EXPECTED.defects.slice(1).map(d => ({
    lens: d.expectedBy,
    findings: [at(d.line, d.severity, d.summary)]
  })));
  const result = score(findings, EXPECTED);
  assert.equal(result.found, EXPECTED.defects.length - 1);
  assert.equal(result.missed.length, 1);
  assert.equal(result.missed[0].id, EXPECTED.defects[0].id);
  assert.equal(result.missed[0].expectedBy, EXPECTED.defects[0].expectedBy);
});

test('a finding on no planted defect counts as a false positive', () => {
  const findings = merge([
    { lens: 'check', findings: [at(3, 'BLOCK', 'imagined defect on an import')] }
  ]);
  const result = score(findings, EXPECTED);
  assert.equal(result.falsePositives, 1);
  assert.equal(result.precision, 0);
  assert.equal(result.perLens.check.falsePositives, 1);
});

test('severity disagreement is reported without counting as a miss', () => {
  const defect = byId('falsy-quota-reset');
  const findings = merge([
    { lens: 'check', findings: [at(defect.line, 'BLOCK', defect.summary)] }
  ]);
  const result = score(findings, EXPECTED);
  assert.equal(result.found, 1, 'still found');
  assert.equal(result.severityMismatches.length, 1);
  assert.deepEqual(result.severityMismatches[0],
    { id: 'falsy-quota-reset', expected: 'FIX', reported: 'BLOCK' });
});

test('per-lens recall is measured only against defects that lens owns', () => {
  const owned = EXPECTED.defects.filter(d => lensIsCredited('check', d));
  const findings = merge([{
    lens: 'check',
    findings: owned.map(d => at(d.line, d.severity, d.summary))
  }]);
  const result = score(findings, EXPECTED);
  assert.equal(result.perLens.check.owned, owned.length);
  assert.equal(result.perLens.check.recall, 1,
    'full credit for its own defects, unpenalized for others');
  assert.ok(result.recall < 1, 'overall recall still reflects the gaps');
});

test('consensus precision is measurable against solo precision', () => {
  const real = byId('unguarded-expiry-read');
  const findings = merge([
    // two independent lenses agree on a real defect
    { lens: 'check', findings: [at(real.line, 'BLOCK', 'stale read')] },
    { lens: 'architect', findings: [at(real.line, 'BLOCK', 'Stale read!')] },
    // one lens alone reports something imaginary
    { lens: 'ux', findings: [at(2, 'BLOCK', 'imagined')] }
  ]);
  const result = score(findings, EXPECTED);
  assert.equal(result.consensusCount, 1);
  assert.equal(result.soloCount, 1);
  assert.equal(result.consensusPrecision, 1);
  assert.equal(result.soloPrecision, 0);
  assert.ok(result.consensusPrecision > result.soloPrecision,
    'this is the claim the whole ranking rests on');
});

test('scoring an empty run reports zero recall, not a crash or a null score', () => {
  const result = score([], EXPECTED);
  assert.equal(result.found, 0);
  assert.equal(result.recall, 0);
  assert.equal(result.reported, 0);
  assert.equal(result.precision, null, 'precision is undefined with no findings');
  assert.equal(result.missed.length, EXPECTED.defects.length);
});

test('the formatted report states both precisions so the claim can be checked', () => {
  const findings = merge([
    { lens: 'check', findings: [at(byId('swallowed-error').line, 'BLOCK', 'x')] }
  ]);
  const text = formatScore(score(findings, EXPECTED));
  assert.match(text, /defects planted:\s+7/);
  assert.match(text, /consensus \(\d+\)/);
  assert.match(text, /solo\s+\(\d+\)/);
  assert.match(text, /per lens:/);
  assert.match(text, /decoration/, 'the failure mode is named in the output');
});
