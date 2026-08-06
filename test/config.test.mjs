/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIG_FILENAMES,
  CONFIG_KEYS,
  findConfig,
  mergeConfig,
  validateConfig
} from '../lib/config.mjs';

test('a well-formed config parses to the expected shape', () => {
  const { config, problems } = validateConfig({
    exec: 'claude -p',
    lenses: './lenses',
    concurrency: 2,
    only: ['check', 'taint'],
    mixed: true
  });
  assert.deepEqual(problems, []);
  assert.equal(config.exec, 'claude -p');
  assert.equal(config.concurrency, 2);
  assert.deepEqual(config.only, ['check', 'taint']);
  assert.equal(config.mixed, true);
});

test('a comma string is accepted for list keys', () => {
  const { config } = validateConfig({ skip: 'ux, architect' });
  assert.deepEqual(config.skip, ['ux', 'architect']);
});

test('an unknown key is reported, not silently ignored', () => {
  // A misspelled `exec` that quietly does nothing is worse than an error.
  const { config, problems } = validateConfig({ exce: 'claude -p' }, 'x.json');
  assert.deepEqual(config, {});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unknown key "exce"/);
  assert.match(problems[0], /exec/, 'the message lists the valid keys');
});

test('comment keys and $schema are allowed through', () => {
  const { config, problems } = validateConfig({
    '// note': 'why we skip ux', $schema: 'https://example', exec: 'x'
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(config, { exec: 'x' });
});

test('wrong types are rejected with the key named', () => {
  const cases = [
    [{ concurrency: 0 }, /concurrency.*integer >= 1/],
    [{ concurrency: 'lots' }, /concurrency.*integer >= 1/],
    [{ context: -1 }, /context.*integer >= 0/],
    [{ mixed: 'yes' }, /mixed.*true or false/],
    [{ exec: '' }, /exec.*non-empty string/],
    [{ exec: 42 }, /exec.*non-empty string/],
    [{ only: 7 }, /only.*list or a comma string/]
  ];
  for (const [input, pattern] of cases) {
    const { problems } = validateConfig(input, 'c');
    assert.equal(problems.length, 1, JSON.stringify(input));
    assert.match(problems[0], pattern);
  }
});

test('a non-object config is rejected rather than half-applied', () => {
  assert.match(validateConfig([], 'c').problems[0], /JSON object/);
  assert.match(validateConfig('exec=x', 'c').problems[0], /JSON object/);
  assert.deepEqual(validateConfig(null).problems, []);
});

test('command-line flags override the file', () => {
  const merged = mergeConfig(
    { exec: 'from-file', concurrency: 2 },
    { exec: 'from-cli' });
  assert.equal(merged.exec, 'from-cli');
  assert.equal(merged.concurrency, 2, 'untouched keys survive');
});

test('an absent CLI flag does not erase a file value', () => {
  const merged = mergeConfig({ exec: 'from-file' }, { exec: undefined });
  assert.equal(merged.exec, 'from-file');
});

test('list keys normalise to arrays from either source', () => {
  assert.deepEqual(mergeConfig({}, { only: 'check, ux' }).only, ['check', 'ux']);
  assert.deepEqual(mergeConfig({ skip: 'a,b' }, {}).skip, ['a', 'b']);
  assert.deepEqual(mergeConfig({ only: ['a'] }, {}).only, ['a']);
});

test('every documented filename is searched', () => {
  assert.ok(CONFIG_FILENAMES.includes('.crosscheckrc.json'));
  assert.ok(CONFIG_FILENAMES.length >= 2);
  assert.ok(CONFIG_KEYS.has('exec'));
});

test('the search walks upward so a subdirectory inherits the project config', () => {
  const present = new Set(['/repo/.crosscheckrc.json']);
  const found = findConfig('/repo/src/deep', { exists: p => present.has(p) });
  assert.equal(found, '/repo/.crosscheckrc.json');
});

test('the nearest config wins over one further up', () => {
  const present = new Set([
    '/repo/.crosscheckrc.json', '/repo/pkg/.crosscheckrc.json'
  ]);
  assert.equal(
    findConfig('/repo/pkg/src', { exists: p => present.has(p) }),
    '/repo/pkg/.crosscheckrc.json');
});

test('the walk stops at a declared root', () => {
  const present = new Set(['/.crosscheckrc.json']);
  assert.equal(
    findConfig('/repo/src', {
      exists: p => present.has(p),
      isRoot: d => d === '/repo'
    }),
    null, 'a config above the project root must not be picked up');
});

test('no config anywhere returns null rather than throwing', () => {
  assert.equal(findConfig('/a/b/c', { exists: () => false }), null);
});

test('findConfig without a probe fails loudly', () => {
  assert.throws(() => findConfig('/a'), /requires an exists\(\) probe/);
});
