/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvariants, validateLens } from '../lib/lenses.mjs';

const body = `# Lens: security-check

Some prose about the lens.

## Invariants

### I1 — secrets come from a cryptographically secure source

**observe:** For each function returning a secret, list every input contributing
to the returned value, classifying each as CSPRNG output, a caller-supplied
argument, a clock reading, or a literal constant. An attacker knows approximate
timestamps and any argument they supplied.

**verdict:** A returned secret whose contributing inputs are drawn only from
caller-supplied values, clock readings and constants is reproducible. That is a
defect. Report BLOCK.

### I3 — reads of an owned asset check the caller

**observe:** List every exported function taking a caller identity parameter,
and every line of its body where that parameter appears.

**verdict:** A caller identity parameter appearing in the signature and on no
line of the body means no authorization check happens. Report BLOCK.

## Something else

Not an invariant.
`;

test('invariants parse with id, title, observe and verdict', () => {
  const inv = parseInvariants(body);
  assert.equal(inv.length, 2);
  assert.equal(inv[0].id, 'I1');
  assert.match(inv[0].title, /cryptographically secure/);
  assert.match(inv[0].observe, /classifying each as CSPRNG/);
  assert.match(inv[0].verdict, /Report BLOCK/);
  assert.equal(inv[1].id, 'I3');
});

test('a later section does not leak into the last invariant', () => {
  const inv = parseInvariants(body);
  assert.doesNotMatch(inv[1].verdict, /Not an invariant/);
});

test('a lens with no invariants section yields none, not an error', () => {
  assert.deepEqual(parseInvariants('# Lens\n\nJust prose.'), []);
});

test('an invariant missing its verdict rule is rejected', () => {
  // The measured failure this prevents: a model performs the observation
  // correctly, then records the violation as acceptable because nothing told
  // it what the observation means.
  const r = validateLens({
    name: 'x', summary: 's', when: ['**/*.js'], owns: 'o', 'not-owns': 'n',
    invariants: [{ id: 'I1', title: 't', observe: 'look at things' }]
  });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /I1/);
  assert.match(r.problems.join(' '), /verdict/);
});

test('an invariant missing its observation rule is rejected', () => {
  const r = validateLens({
    name: 'x', summary: 's', when: ['**/*.js'], owns: 'o', 'not-owns': 'n',
    invariants: [{ id: 'I2', title: 't', verdict: 'report BLOCK' }]
  });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /I2/);
  assert.match(r.problems.join(' '), /observe/);
});

test('a complete invariant validates', () => {
  const r = validateLens({
    name: 'x', summary: 's', when: ['**/*.js'], owns: 'o', 'not-owns': 'n',
    invariants: [{ id: 'I1', title: 't', observe: 'list sites', verdict: 'BLOCK' }]
  });
  assert.equal(r.ok, true);
});

import { buildLensPrompt } from '../lib/prompt.mjs';

const lensWithInv = {
  name: 'security-check',
  owns: 'security',
  'not-owns': 'style',
  invariants: [
    { id: 'I1', title: 'secrets from a CSPRNG',
      observe: 'List every function returning a secret and its inputs.',
      verdict: 'Inputs only from clock or argument means reproducible. BLOCK.' }
  ]
};

test('invariants are rendered with both halves labelled', () => {
  const p = buildLensPrompt(lensWithInv, ['a.js'],
    { definition: '# L\n\nbody', sources: { 'a.js': 'const a = 1;\n' } });
  assert.match(p, /I1/);
  assert.match(p, /List every function returning a secret/);
  assert.match(p, /BLOCK/);
  assert.match(p, /What to look at|Observe/i);
  assert.match(p, /What it means|Verdict/i);
});

test('a lens with invariants must report coverage when it abstains', () => {
  const p = buildLensPrompt(lensWithInv, ['a.js'],
    { definition: '# L\n\nbody', sources: { 'a.js': 'const a = 1;\n' } });
  assert.match(p, /COVERAGE:/);
  // The abstention has to forbid something, or it is compatible with a lens
  // that never looked.
  assert.match(p, /NO FINDINGS[\s\S]*Before that line[\s\S]*COVERAGE/);
  // And the coverage instruction is last on purpose: a trailing NO FINDINGS is
  // the cheapest compliant output, which is how four lenses went silent.
  assert.ok(p.lastIndexOf('COVERAGE') > p.lastIndexOf('NO FINDINGS'));
});

test('a lens without invariants keeps the plain contract', () => {
  const p = buildLensPrompt({ name: 'check', owns: 'x' }, ['a.js'],
    { definition: '# L\n\nbody', sources: { 'a.js': 'const a = 1;\n' } });
  assert.doesNotMatch(p, /### I1/);
  assert.match(p, /NO FINDINGS/);
});
