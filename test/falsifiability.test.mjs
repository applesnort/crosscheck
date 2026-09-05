/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// A test is only evidence if it ran. These cover the three ways "no test
// occurred" can be mistaken for "the test came back negative".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict } from '../lib/prompt.mjs';

test('an explicit refutation refutes', () => {
  const v = parseVerdict('REFUTED — the caller already validates this');
  assert.equal(v.refuted, true);
  assert.equal(v.tested, true);
});

test('an explicit confirmation stands', () => {
  const v = parseVerdict('CONFIRMED — null reaches line 12 on the empty path');
  assert.equal(v.refuted, false);
  assert.equal(v.tested, true);
});

test('an unusable verdict has not refuted anything', () => {
  // The verifier's job is to refute. Output it could not produce is not a
  // refutation, and dropping the finding would treat silence as evidence.
  const v = parseVerdict('I am not sure what you are asking me to do.');
  assert.equal(v.refuted, false, 'must not drop the finding');
  assert.equal(v.tested, false, 'and must not claim the test ran');
});

test('empty verifier output has not refuted anything', () => {
  for (const empty of ['', '   ', null, undefined]) {
    const v = parseVerdict(empty);
    assert.equal(v.refuted, false, `${JSON.stringify(empty)} must not refute`);
    assert.equal(v.tested, false);
  }
});

test('an untested finding says why, so it is not read as corroborated', () => {
  const v = parseVerdict('garbage');
  assert.match(v.reason, /no usable verdict|did not run|not test/i);
});

import { applyVerdicts } from '../lib/merge.mjs';

const finding = (key) => ({ key, file: 'a.js', line: 1, severity: 'BLOCK' });

test('a finding whose verifier produced nothing stands, but not as corroborated', () => {
  const r = applyVerdicts([finding('k1')],
    { k1: { tested: false, refuted: false, reason: 'no usable verdict' } });
  assert.equal(r.findings.length, 1, 'it stands');
  assert.deepEqual(r.refuted, [], 'it was not refuted');
  assert.deepEqual(r.untested.map(f => f.key), ['k1'],
    'and it is counted apart from findings that survived a real attempt');
});

test('a finding that survived a real refutation attempt is not listed untested', () => {
  const r = applyVerdicts([finding('k1')],
    { k1: { tested: true, refuted: false, reason: 'trigger verified' } });
  assert.equal(r.findings.length, 1);
  assert.deepEqual(r.untested, []);
});

test('a refuted finding is still removed and counted', () => {
  const r = applyVerdicts([finding('k1')],
    { k1: { tested: true, refuted: true, reason: 'guarded upstream' } });
  assert.deepEqual(r.findings, []);
  assert.equal(r.refuted.length, 1);
  assert.deepEqual(r.untested, []);
});
