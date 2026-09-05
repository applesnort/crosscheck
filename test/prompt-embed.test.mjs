/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLensPrompt, sharedSourcePrefix } from '../lib/prompt.mjs';

const lensA = { name: 'check', owns: 'runtime defects' };
const lensB = { name: 'taint', owns: 'untrusted input' };
const def = '# Lens\n\nBody of the lens.';

const sources = {
  'src/b.js': 'const b = 1;\nexport { b };\n',
  'src/a.js': 'const a = 2;\nexport { a };\n'
};
const files = ['src/b.js', 'src/a.js'];

test('embed puts the source in the prompt', () => {
  const p = buildLensPrompt(lensA, files, { definition: def, sources });
  assert.match(p, /const a = 2;/);
  assert.match(p, /const b = 1;/);
});

test('embed line-numbers the source so findings can cite a line', () => {
  const p = buildLensPrompt(lensA, files, { definition: def, sources });
  assert.match(p, /\b1\s+const b = 1;/);
  assert.match(p, /\b2\s+export \{ b \};/);
});

test('the source block is byte-identical across lenses on the same files', () => {
  const a = buildLensPrompt(lensA, files, { definition: def, sources });
  const b = buildLensPrompt(lensB, files, { definition: 'different', sources });
  const prefix = sharedSourcePrefix(files, { sources });
  assert.ok(prefix.length > 0, 'prefix must not be empty');
  assert.ok(a.startsWith(prefix), 'lens A must open with the shared prefix');
  assert.ok(b.startsWith(prefix), 'lens B must open with the shared prefix');
});

test('file order is sorted, so the prefix does not depend on caller order', () => {
  const one = sharedSourcePrefix(['src/b.js', 'src/a.js'], { sources });
  const two = sharedSourcePrefix(['src/a.js', 'src/b.js'], { sources });
  assert.equal(one, two);
  assert.ok(one.indexOf('src/a.js') < one.indexOf('src/b.js'));
});

test('the lens definition comes after the source, never before', () => {
  const p = buildLensPrompt(lensA, files, { definition: def, sources });
  assert.ok(p.indexOf('const a = 2;') < p.indexOf('Body of the lens.'),
    'source must precede the lens definition or nothing caches');
});

test('embedding tells the runner not to open files', () => {
  const p = buildLensPrompt(lensA, files, { definition: def, sources });
  assert.doesNotMatch(p, /reading each one completely/);
});

test('without sources it keeps the name-the-files prompt', () => {
  const p = buildLensPrompt(lensA, files, { definition: def });
  assert.match(p, /Audit exactly these 2 file\(s\)/);
  assert.doesNotMatch(p, /const a = 2;/);
});

test('a file with no content available fails loudly rather than reviewing air', () => {
  assert.throws(
    () => buildLensPrompt(lensA, ['src/a.js', 'src/missing.js'],
      { definition: def, sources }),
    /missing\.js/);
});

test('scope hunks embeds only changed spans plus context', () => {
  const long = Array.from({ length: 40 }, (_, i) => `line${i + 1}`).join('\n');
  const p = buildLensPrompt(
    { ...lensA, scope: 'hunks' }, ['src/long.js'],
    {
      definition: def,
      sources: { 'src/long.js': long },
      rangesByFile: { 'src/long.js': [[20, 21]] },
      hunkContext: 3
    });
  assert.match(p, /line20/);
  assert.match(p, /line17/);
  assert.doesNotMatch(p, /line1\b/);
  assert.match(p, /elided/i);
});
