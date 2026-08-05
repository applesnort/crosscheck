/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyOverrides,
  globToRegExp,
  matchesAny,
  parseFrontmatter,
  routeRoster,
  validateLens
} from '../lib/lenses.mjs';

const LENS_DIR = new URL('../lenses/', import.meta.url).pathname;

test('parses the frontmatter subset the lenses use', () => {
  const meta = parseFrontmatter([
    '---',
    'name: check',
    'summary: correctness',
    'when: [**/*.js, **/*.ts]',
    'owns: correctness defects',
    'not-owns: style, architecture',
    'cites: ["OWASP Top 10 (2021)"]',
    'core: false',
    '# a comment',
    '---',
    '',
    '# Lens: check'
  ].join('\n'));
  assert.equal(meta.name, 'check');
  assert.deepEqual(meta.when, ['**/*.js', '**/*.ts']);
  assert.deepEqual(meta.cites, ['OWASP Top 10 (2021)']);
  assert.equal(meta.core, false);
  assert.equal(meta['not-owns'], 'style, architecture');
});

test('a document with no frontmatter parses as null', () => {
  assert.equal(parseFrontmatter('# Lens: check\n\nsome prose'), null);
});

test('validation requires the routing and scope keys', () => {
  const complete = {
    name: 'check', summary: 's', when: ['**/*.js'], owns: 'o', 'not-owns': 'n'
  };
  assert.deepEqual(validateLens(complete), { ok: true, problems: [] });
  for (const key of ['name', 'summary', 'when', 'owns']) {
    const broken = { ...complete };
    delete broken[key];
    const result = validateLens(broken);
    assert.equal(result.ok, false, `missing ${key} should fail`);
    assert.match(result.problems.join(' '), new RegExp(key));
  }
});

test('a lens that never declines is rejected — it would dilute consensus', () => {
  const result = validateLens({
    name: 'check', summary: 's', when: ['**/*.js'], owns: 'everything'
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /not-owns/);
});

test('an empty when list is rejected, not treated as match-everything', () => {
  const result = validateLens({
    name: 'x', summary: 's', when: [], owns: 'o', 'not-owns': 'n'
  });
  assert.equal(result.ok, false);
});

test('a scalar `when` is rejected with a usable message', () => {
  const result = validateLens({
    name: 'x', summary: 's', when: '**/*.js', owns: 'o', 'not-owns': 'n'
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /list of globs/);
});

test('missing frontmatter fails validation rather than throwing', () => {
  assert.deepEqual(validateLens(null),
    { ok: false, problems: ['missing frontmatter block'] });
});

// --- glob matching ---

test('* stays within a path segment', () => {
  assert.ok(globToRegExp('lib/*.js').test('lib/a.js'));
  assert.ok(!globToRegExp('lib/*.js').test('lib/nested/a.js'));
});

test('**/ crosses separators and matches zero directories', () => {
  const re = globToRegExp('**/*.js');
  assert.ok(re.test('a.js'));
  assert.ok(re.test('lib/a.js'));
  assert.ok(re.test('lib/deep/nested/a.js'));
  assert.ok(!re.test('lib/a.ts'));
});

test('brace alternation and ? are supported', () => {
  assert.ok(globToRegExp('**/*.{js,mjs}').test('lib/a.mjs'));
  assert.ok(globToRegExp('**/*.{js,mjs}').test('a.js'));
  assert.ok(!globToRegExp('**/*.{js,mjs}').test('a.ts'));
  assert.ok(globToRegExp('lib/a?.js').test('lib/ab.js'));
  assert.ok(!globToRegExp('lib/a?.js').test('lib/abc.js'));
});

test('dots are literal, not wildcards', () => {
  assert.ok(!globToRegExp('**/*.js').test('lib/axjs'));
});

test('matchesAny is false for an empty or absent glob list', () => {
  assert.equal(matchesAny('a.js', []), false);
  assert.equal(matchesAny('a.js', undefined), false);
});

// --- routing ---

const LENSES = [
  { name: 'check', when: ['**/*.{js,mjs}'] },
  { name: 'ux', when: ['**/*.jsx', '**/*.vue'] },
  { name: 'ci', when: ['.github/workflows/**'] }
];

test('routing selects relevant lenses and reports each skip with a reason', () => {
  const { roster, skipped } = routeRoster(LENSES, ['lib/a.js', 'lib/b.mjs']);
  assert.deepEqual(roster.map(l => l.name), ['check']);
  assert.deepEqual(roster[0].files, ['lib/a.js', 'lib/b.mjs']);
  assert.deepEqual(skipped.map(s => s.lens), ['ux', 'ci']);
  assert.ok(skipped.every(s => s.reason), 'every skip carries a reason');
});

test('a lens receives only the files it matched', () => {
  const { roster } = routeRoster(LENSES,
    ['lib/a.js', 'app/x.vue', '.github/workflows/main.yaml']);
  assert.deepEqual(roster.find(l => l.name === 'ux').files, ['app/x.vue']);
  assert.deepEqual(roster.find(l => l.name === 'ci').files,
    ['.github/workflows/main.yaml']);
});

test('an empty target routes nothing and skips everything', () => {
  const { roster, skipped } = routeRoster(LENSES, []);
  assert.deepEqual(roster, []);
  assert.equal(skipped.length, 3);
});

test('--only narrows the roster and records what it excluded', () => {
  const routed = routeRoster(LENSES, ['lib/a.js', 'app/x.vue']);
  const { roster, skipped } = applyOverrides(routed, { only: ['ux'] });
  assert.deepEqual(roster.map(l => l.name), ['ux']);
  assert.ok(skipped.some(s => s.lens === 'check' && /--only/.test(s.reason)));
});

test('--skip removes a lens and records why', () => {
  const routed = routeRoster(LENSES, ['lib/a.js', 'app/x.vue']);
  const { roster, skipped } = applyOverrides(routed, { skip: ['check'] });
  assert.deepEqual(roster.map(l => l.name), ['ux']);
  assert.ok(skipped.some(s => s.lens === 'check' && /--skip/.test(s.reason)));
});

test('overrides with nothing set leave the roster untouched', () => {
  const routed = routeRoster(LENSES, ['lib/a.js']);
  assert.deepEqual(applyOverrides(routed, {}).roster.map(l => l.name), ['check']);
  assert.deepEqual(applyOverrides(routed).roster.map(l => l.name), ['check']);
});

// --- the shipped lenses must satisfy their own contract ---

test('every shipped lens has valid frontmatter', () => {
  const files = readdirSync(LENS_DIR).filter(f => f.endsWith('.md'));
  assert.ok(files.length >= 4, 'lenses are present');
  for (const file of files) {
    const meta = parseFrontmatter(readFileSync(join(LENS_DIR, file), 'utf8'));
    const result = validateLens(meta);
    assert.equal(result.ok, true,
      `${file}: ${result.problems.join('; ')}`);
    assert.equal(meta.name, file.replace(/\.md$/, ''),
      `${file}: name must match filename`);
  }
});

test('every shipped lens states the output contract and NO FINDINGS', () => {
  for (const file of readdirSync(LENS_DIR).filter(f => f.endsWith('.md'))) {
    const text = readFileSync(join(LENS_DIR, file), 'utf8');
    assert.match(text, /file:line/, `${file} documents the location format`);
    assert.match(text, /NO FINDINGS/, `${file} documents the empty result`);
    assert.match(text, /BLOCK/, `${file} documents the severity scale`);
  }
});
