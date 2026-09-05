/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLens, LENS_SCOPES, LENS_EFFORTS } from '../lib/lenses.mjs';

const base = {
  name: 'check', summary: 's', when: ['**/*.js'],
  owns: 'defects', 'not-owns': 'style'
};

test('scope and effort are optional', () => {
  assert.equal(validateLens(base).ok, true);
});

test('a valid scope and effort are accepted', () => {
  for (const scope of LENS_SCOPES) {
    assert.equal(validateLens({ ...base, scope }).ok, true, scope);
  }
  for (const effort of LENS_EFFORTS) {
    assert.equal(validateLens({ ...base, effort }).ok, true, effort);
  }
});

test('a misspelled scope is an error, not a silent default', () => {
  const r = validateLens({ ...base, scope: 'hunk' });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /scope/);
  assert.match(r.problems.join(' '), /hunks/);
});

test('a misspelled effort is an error, not a silent default', () => {
  const r = validateLens({ ...base, effort: 'maximum' });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /effort/);
});

test('hunks scope on a lens that reads whole files is still the author choice', () => {
  // taint follows data across a file; crosscheck does not override the author,
  // it only refuses values it cannot act on.
  assert.equal(validateLens({ ...base, name: 'taint', scope: 'hunks' }).ok, true);
});
