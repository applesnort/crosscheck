/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyOverrides,
  globToRegExp,
  matchesAny,
  parseFrontmatter,
  routeRoster,
  validateLens
} from '../lib/lenses.mjs';

const LENS_DIR = fileURLToPath(new URL('../lenses/', import.meta.url));

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

test('a braced glob in frontmatter stays one pattern', () => {
  // Splitting `**/*.{js,mjs}` on commas yields three broken globs, and the lens
  // then matches nothing. This shipped broken until an end-to-end run caught it.
  const meta = parseFrontmatter([
    '---',
    'name: check',
    'summary: s',
    'when: [**/*.{js,mjs,cjs}, **/migrations/**]',
    'owns: o',
    'not-owns: n',
    '---'
  ].join('\n'));
  assert.deepEqual(meta.when, ['**/*.{js,mjs,cjs}', '**/migrations/**']);
  assert.equal(matchesAny('lib/a.js', meta.when), true);
  assert.equal(matchesAny('lib/a.mjs', meta.when), true);
  assert.equal(matchesAny('db/migrations/001.sql', meta.when), true);
  assert.equal(matchesAny('lib/a.ts', meta.when), false);
});

test('quoted list entries containing commas survive', () => {
  const meta = parseFrontmatter([
    '---', 'name: x', 'summary: s', 'when: ["a,b.js", **/*.js]',
    'owns: o', 'not-owns: n', '---'
  ].join('\n'));
  assert.deepEqual(meta.when, ['a,b.js', '**/*.js']);
});

test('every shipped lens routes to an ordinary source file', () => {
  // The end-to-end check the unit tests missed: real frontmatter, real globs.
  const files = readdirSync(LENS_DIR).filter(f => f.endsWith('.md'));
  const routable = files.filter(file => {
    const meta = parseFrontmatter(readFileSync(join(LENS_DIR, file), 'utf8'));
    return matchesAny('lib/example.js', meta.when);
  });
  assert.ok(routable.length >= 3,
    `only ${routable.length} lens(es) match a plain .js file — check the globs`);
});

test('the code lenses route to a single-file component', () => {
  // A .vue/.svelte file is mostly JavaScript and routinely holds the largest
  // component in a project. Only `ux` used to glob these, so a 2000-line
  // component was reviewed for usability and by nothing else -- reported as a
  // complete run, because every lens that skipped it "matched nothing in
  // scope".
  const meta = name => parseFrontmatter(
    readFileSync(join(LENS_DIR, `${name}.md`), 'utf8'));
  for (const component of ['app/Cockpit.vue', 'app/Panel.svelte']) {
    for (const name of ['check', 'architect', 'security-check', 'taint']) {
      assert.ok(matchesAny(component, meta(name).when),
        `${name} does not route ${component} — its logic goes unreviewed`);
    }
  }
});

// --- layered lens sources ---

import { resolveLensSet } from '../lib/lenses.mjs';

const lens = (name, extra = {}) =>
  ({ name, when: ['**/*.js'], owns: 'o', 'not-owns': 'n', ...extra });

test('later sources add to earlier ones rather than replacing them', () => {
  const { lenses } = resolveLensSet([
    { origin: 'builtin', lenses: [lens('check'), lens('ux')] },
    { origin: 'mine', lenses: [lens('chaos')] }
  ]);
  assert.deepEqual(lenses.map(l => l.name), ['chaos', 'check', 'ux'],
    'adding one lens must not cost you the other five');
});

test('a same-named lens in a later source shadows the earlier one', () => {
  const { lenses, shadowed } = resolveLensSet([
    { origin: 'builtin', lenses: [lens('check', { owns: 'stock' })] },
    { origin: 'mine', lenses: [lens('check', { owns: 'customised' })] }
  ]);
  assert.equal(lenses.length, 1);
  assert.equal(lenses[0].owns, 'customised');
  assert.equal(lenses[0].origin, 'mine');
  assert.deepEqual(shadowed,
    [{ name: 'check', winner: 'mine', shadowedFrom: 'builtin' }],
    'an override must be reported, not silent');
});

test('each resolved lens records where it came from', () => {
  const { lenses } = resolveLensSet([
    { origin: '/pkg/lenses', lenses: [lens('check')] },
    { origin: './lenses', lenses: [lens('chaos')] }
  ]);
  assert.equal(lenses.find(l => l.name === 'check').origin, '/pkg/lenses');
  assert.equal(lenses.find(l => l.name === 'chaos').origin, './lenses');
});

test('nothing shadowed means an empty report, not undefined', () => {
  const { shadowed } = resolveLensSet([
    { origin: 'a', lenses: [lens('check')] }
  ]);
  assert.deepEqual(shadowed, []);
});

test('a nameless lens is skipped rather than crashing the set', () => {
  const { lenses } = resolveLensSet([
    { origin: 'a', lenses: [lens('check'), { when: ['**/*.js'] }] }
  ]);
  assert.deepEqual(lenses.map(l => l.name), ['check']);
});

test('no sources resolves to an empty set', () => {
  assert.deepEqual(resolveLensSet([]).lenses, []);
  assert.deepEqual(resolveLensSet(undefined).lenses, []);
});

// Windows. `collectFiles` reports paths with the platform separator, so on
// Windows a lens saw `src\components\Btn.jsx`. Extension globs matched anyway —
// `[^/]*` happily eats a backslash — so the roster filled and no UNREVIEWED
// warning fired, but every directory-anchored glob silently stopped matching.
// Coverage narrowed and the run still looked complete.
test('directory globs match a path that uses Windows separators', () => {
  assert.equal(matchesAny('src\\components\\Btn.jsx', ['**/components/**']), true);
  assert.equal(matchesAny('db\\migrations\\001.sql', ['**/migrations/**']), true);
  assert.equal(matchesAny('a\\b\\c\\deep.js', ['a/**/*.js']), true);
});

test('a Windows path still fails a glob it genuinely does not match', () => {
  assert.equal(matchesAny('src\\views\\Btn.jsx', ['**/components/**']), false);
  assert.equal(matchesAny('src\\app.css', ['**/*.js']), false);
});

// The whole point of the separator fix, asserted against the shipped lenses
// rather than a hand-written glob: the same tree must produce the same roster
// whichever separator the platform reports it with.
test('a Windows tree routes to the same roster as a POSIX one', () => {
  const posix = [
    'src/app.js', 'src/components/Btn.jsx', 'db/migrations/001.sql',
    'src/views/Page.vue', 'src/pages/Home.tsx',
    // Reaches ux only via `**/components/**` — no extension glob claims it. If
    // the separator fix regresses, this is the file that stops being reviewed.
    'src/components/panel.css'
  ];
  const windows = posix.map(f => f.replace(/\//g, '\\'));
  const shipped = readdirSync(LENS_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => parseFrontmatter(
      readFileSync(join(LENS_DIR, f), 'utf8')));
  assert.ok(shipped.length >= 5, 'the shipped lenses were found');

  const rosterFor = files => routeRoster(shipped, files).roster
    .map(l => `${l.name}:${l.files.length}`).sort();
  assert.deepEqual(rosterFor(windows), rosterFor(posix));
  // Not a vacuous pass: the directory-anchored globs must actually contribute.
  assert.ok(rosterFor(posix).includes('ux:4'),
    'ux routes components/, views/ and pages/ on top of its extensions');
  assert.equal(matchesAny('src\\components\\panel.css', ['**/*.{jsx,tsx,vue,svelte,html}']),
    false, 'the .css file is claimed by the directory glob alone');
});
