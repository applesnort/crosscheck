/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// A positive control: a known violation the lens must catch. It does not prove
// the lens found the real defects — nothing here claims that — it establishes
// that the runner can perform the check at all, which is the one thing
// coverage and calibration provenance cannot establish from inside a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvariants, validateLens } from '../lib/lenses.mjs';
import { CONTROL_PREFIX, buildLensPrompt } from '../lib/prompt.mjs';
import { splitControlFindings } from '../lib/parse.mjs';

const body = `# Lens: x

## Invariants

### I2 — secrets compared in constant time

**observe:** List every equality site where an operand is a secret.

**verdict:** \`===\` on a secret is a defect. Report BLOCK.

**canary:** function check(a, b) { return a === b; } // a and b are tokens
`;

test('an invariant can carry a canary', () => {
  const inv = parseInvariants(body);
  assert.equal(inv.length, 1);
  assert.match(inv[0].canary, /a === b/);
});

test('a canary is optional', () => {
  const r = validateLens({
    name: 'x', summary: 's', when: ['**/*.js'], owns: 'o', 'not-owns': 'n',
    invariants: [{ id: 'I1', title: 't', observe: 'look', verdict: 'BLOCK' }]
  });
  assert.equal(r.ok, true);
});

test('the control block is rendered under a path of its own', () => {
  const p = buildLensPrompt(
    { name: 'x', owns: 'o', invariants: parseInvariants(body) },
    ['a.js'], { definition: '# L\n\nb', sources: { 'a.js': 'const a = 1;\n' } });
  assert.ok(p.includes(CONTROL_PREFIX), 'control files are addressable');
  assert.match(p, /a === b/, 'the canary source is present');
});

test('controls are rendered apart from the reviewed source', () => {
  // Controls are per-lens and must stay distinguishable from the repository
  // under review, so a finding about a canary is never a finding about code.
  const withInv = buildLensPrompt(
    { name: 'x', owns: 'o', invariants: parseInvariants(body) },
    ['a.js'], { definition: '# L\n\nb', sources: { 'a.js': 'const a = 1;\n' } });
  assert.ok(withInv.indexOf('--- END SOURCE ---') <
    withInv.indexOf(CONTROL_PREFIX), 'controls follow the reviewed source');
});

test('control findings are separated from findings about real code', () => {
  const { real, controls } = splitControlFindings([
    { file: 'a.js', line: 4, severity: 'BLOCK' },
    { file: `${CONTROL_PREFIX}I2.js`, line: 1, severity: 'BLOCK' }
  ]);
  assert.equal(real.length, 1);
  assert.deepEqual(controls, ['I2']);
});

test('a control the lens never flagged is reported as not demonstrated', () => {
  const { controls } = splitControlFindings([
    { file: 'a.js', line: 4, severity: 'BLOCK' }
  ]);
  assert.deepEqual(controls, []);
});

import { mergeFindings, panelVerdict, countsBySeverity } from '../lib/merge.mjs';

test('a lens that missed a control is recorded as undemonstrated', () => {
  const m = mergeFindings([{
    lens: 'security-check', findings: [], unparsed: [],
    coverage: [{ id: 'I2', examined: '3 sites' }],
    controls: ['I1'], controlsExpected: ['I1', 'I2', 'I3']
  }]);
  assert.equal(m.undemonstrated.length, 1);
  assert.equal(m.undemonstrated[0].lens, 'security-check');
  assert.deepEqual(m.undemonstrated[0].missed, ['I2', 'I3']);
});

test('a failed control voids the abstention even when coverage was stated', () => {
  // Coverage is the lens claiming it looked. A failed control is the lens
  // demonstrating it cannot perform the check. The demonstration wins.
  const m = mergeFindings([{
    lens: 'security-check', findings: [], unparsed: [],
    coverage: [{ id: 'I2', examined: 'all of them' }],
    controls: [], controlsExpected: ['I2']
  }]);
  assert.deepEqual(m.unsupported, ['security-check']);
});

test('a lens that caught every control keeps its coverage-backed standing', () => {
  const m = mergeFindings([{
    lens: 'security-check', findings: [], unparsed: [],
    coverage: [{ id: 'I2', examined: '3 sites' }],
    controls: ['I2'], controlsExpected: ['I2']
  }]);
  assert.deepEqual(m.undemonstrated, []);
  assert.deepEqual(m.unsupported, []);
});

test('a lens with no controls declared is neither credited nor penalised', () => {
  const m = mergeFindings([{
    lens: 'check', findings: [], unparsed: [],
    coverage: [{ id: 'scope', examined: 'all' }],
    controls: [], controlsExpected: []
  }]);
  assert.deepEqual(m.undemonstrated, []);
  assert.deepEqual(m.unsupported, []);
});

test('the verdict names a panel that could not demonstrate its checks', () => {
  const v = panelVerdict(countsBySeverity([]), {
    total: 1, silent: ['security-check'], unsupported: ['security-check'],
    undemonstrated: [{ lens: 'security-check', missed: ['I2'] }]
  });
  assert.match(v, /could not demonstrate|control/i);
  assert.doesNotMatch(v, /^Ship/);
});

test('a missed control never softens a real blocker', () => {
  // A control failure means silence carries nothing. It does not mean a
  // reported blocker stops counting — the lens demonstrably found that one.
  const v = panelVerdict({ BLOCK: 3, FIX: 0, CONSIDER: 0 }, {
    total: 1, silent: [], unsupported: [],
    undemonstrated: [{ lens: 'security-check', missed: ['I1'] }]
  });
  assert.match(v, /Do not ship/);
});
