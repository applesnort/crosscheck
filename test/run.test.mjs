/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTRACT_LINE, buildLensPrompt, buildRefutePrompt, parseVerdict,
  stripFrontmatter
} from '../lib/prompt.mjs';
import {
  DEFAULT_CONCURRENCY, planBudget, planRun, promptsFor, resolveExec, runPanel
} from '../lib/run.mjs';
import { createCache } from '../lib/cache.mjs';
import { mergeFindings } from '../lib/merge.mjs';

const LENSES = [
  { name: 'check', when: ['**/*.js'], owns: 'runtime defects',
    'not-owns': 'style, security', definition: '# check\n\nfind bugs' },
  { name: 'ux', when: ['**/*.jsx'], owns: 'usability',
    'not-owns': 'correctness', definition: '# ux\n\nfind friction' }
];

// --- prompt construction ---

test('the prompt states the contract parse.mjs expects', () => {
  const p = buildLensPrompt(LENSES[0], ['lib/a.js'], { definition: 'x' });
  assert.ok(p.includes(CONTRACT_LINE), 'contract line is present verbatim');
  assert.match(p, /NO FINDINGS/);
  assert.match(p, /BLOCK, FIX, or CONSIDER/);
});

test('the prompt lists every file in scope', () => {
  const p = buildLensPrompt(LENSES[0], ['lib/a.js', 'lib/b.js'], { definition: 'x' });
  assert.match(p, /- lib\/a\.js/);
  assert.match(p, /- lib\/b\.js/);
  assert.match(p, /exactly these 2 file\(s\)/);
});

test('both halves of the lens scope reach the prompt', () => {
  const p = buildLensPrompt(LENSES[0], ['lib/a.js'], { definition: 'x' });
  assert.match(p, /You own: runtime defects/);
  assert.match(p, /You do NOT own: style, security/);
});

test('an inlined definition is embedded; otherwise a path is referenced', () => {
  const inlined = buildLensPrompt(LENSES[0], ['a.js'], { definition: '# body here' });
  assert.match(inlined, /BEGIN LENS DEFINITION/);
  assert.match(inlined, /# body here/);
  const byPath = buildLensPrompt(LENSES[0], ['a.js'],
    { definitionPath: '/x/lenses/check.md' });
  assert.match(byPath, /Read `\/x\/lenses\/check\.md`/);
  assert.doesNotMatch(byPath, /BEGIN LENS DEFINITION/);
});

test('a lens with no definition at all is an error, not a vague prompt', () => {
  assert.throws(() => buildLensPrompt(LENSES[0], ['a.js'], {}),
    /neither a definition nor a definitionPath/);
});

test('no files in scope is an error rather than an empty audit', () => {
  assert.throws(() => buildLensPrompt(LENSES[0], [], { definition: 'x' }),
    /no files in scope/);
});

test('mixedCorpus adds the false-positive warning, and is off by default', () => {
  const off = buildLensPrompt(LENSES[0], ['a.js'], { definition: 'x' });
  assert.doesNotMatch(off, /Some of these files are safe/);
  const on = buildLensPrompt(LENSES[0], ['a.js'],
    { definition: 'x', mixedCorpus: true });
  assert.match(on, /Some of these files are safe/);
  assert.match(on, /costs more than a\s+missed one/);
});

test('every prompt forbids editing', () => {
  assert.match(buildLensPrompt(LENSES[0], ['a.js'], { definition: 'x' }),
    /Do not edit any file/);
});

// --- planning ---

test('planning routes by glob and reports each skip with a reason', () => {
  const { roster, skipped } = planRun(LENSES, ['lib/a.js']);
  assert.deepEqual(roster.map(l => l.name), ['check']);
  assert.deepEqual(skipped.map(s => s.lens), ['ux']);
  assert.ok(skipped[0].reason);
});

test('planning with no files is an error, not an empty run', () => {
  assert.throws(() => planRun(LENSES, []), /no files in scope/);
  assert.throws(() => planRun(LENSES, undefined), /no files in scope/);
});

test('--only naming an unknown lens fails loudly', () => {
  assert.throws(() => planRun(LENSES, ['lib/a.js'], { only: ['nope'] }),
    /unknown lens: nope/);
});

test('promptsFor produces one prompt per rostered lens', () => {
  const { roster } = planRun(LENSES, ['lib/a.js', 'app/x.jsx']);
  const jobs = promptsFor(roster);
  assert.deepEqual(jobs.map(j => j.lens).sort(), ['check', 'ux']);
  assert.ok(jobs.every(j => j.prompt.includes(CONTRACT_LINE)));
});

// --- execution ---

const okExec = out => async () => ({ stdout: out, code: 0 });

test('a successful run parses each lens into findings', async () => {
  const { roster, skipped } = planRun(LENSES, ['lib/a.js']);
  const { reports, failures } = await runPanel({
    roster, skipped,
    exec: okExec('lib/a.js:4 — BLOCK — boom — fix it')
  });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].lens, 'check');
  assert.equal(reports[0].findings.length, 1);
  assert.deepEqual(failures, []);
});

test('NO FINDINGS is an empty report, not a failure', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js']);
  const { reports, failures } = await runPanel({
    roster, exec: okExec('NO FINDINGS')
  });
  assert.deepEqual(reports[0].findings, []);
  assert.deepEqual(failures, [],
    'a lens that looked and found nothing has not failed');
});

test('a non-zero exit marks the lens incomplete and records stderr', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js']);
  const { reports, failures } = await runPanel({
    roster,
    exec: async () => ({ stdout: '', stderr: 'model refused', code: 3 })
  });
  assert.equal(reports[0].findings, null, 'incomplete, not empty');
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /exited 3/);
  assert.match(failures[0].reason, /model refused/);
});

test('a thrown executor error marks the lens incomplete', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js']);
  const { reports, failures } = await runPanel({
    roster, exec: async () => { throw new Error('spawn ENOENT'); }
  });
  assert.equal(reports[0].findings, null);
  assert.match(failures[0].reason, /spawn ENOENT/);
});

test('empty output is a failure, because a silent lens must say NO FINDINGS', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js']);
  const { reports, failures } = await runPanel({
    roster, exec: okExec('   \n  ')
  });
  assert.equal(reports[0].findings, null);
  assert.match(failures[0].reason, /no output/);
});

test('an incomplete lens flows through the merge as incomplete', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js', 'app/x.jsx']);
  const { reports } = await runPanel({
    roster,
    exec: async ({ lens }) => lens === 'ux'
      ? { stdout: '', code: 1 }
      : { stdout: 'lib/a.js:4 — BLOCK — boom — fix it', code: 0 }
  });
  const merged = mergeFindings(reports);
  assert.equal(merged.findings.length, 1);
  assert.deepEqual(merged.incomplete, ['ux']);
});

test('reports keep roster order regardless of completion order', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js', 'app/x.jsx']);
  const { reports } = await runPanel({
    roster,
    concurrency: 2,
    exec: async ({ lens }) => {
      // ux resolves on a later microtask turn than check
      if (lens === 'ux') {
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
      }
      return { stdout: 'NO FINDINGS', code: 0 };
    }
  });
  assert.deepEqual(reports.map(r => r.lens), roster.map(l => l.name));
});

test('concurrency is bounded', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    name: `l${i}`, when: ['**/*.js'], owns: 'x', 'not-owns': 'y',
    definition: 'd'
  }));
  let inFlight = 0;
  let peak = 0;
  const { roster } = planRun(many, ['a.js']);
  await runPanel({
    roster, concurrency: 3,
    exec: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setImmediate(r));
      inFlight -= 1;
      return { stdout: 'NO FINDINGS', code: 0 };
    }
  });
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded the limit`);
  assert.ok(DEFAULT_CONCURRENCY >= 1);
});

test('runPanel without an executor fails loudly', async () => {
  await assert.rejects(() => runPanel({ roster: [] }),
    /requires an exec function/);
});

test('skipped lenses are carried through untouched', async () => {
  const { roster, skipped } = planRun(LENSES, ['lib/a.js']);
  const result = await runPanel({ roster, skipped, exec: okExec('NO FINDINGS') });
  assert.deepEqual(result.skipped, skipped);
});

test('frontmatter is stripped from the inlined definition', () => {
  const withMeta = '---\nname: check\nwhen: [**/*.js]\ncites: []\n---\n\n' +
    '# Lens: check\n\nfind the bugs';
  assert.equal(stripFrontmatter(withMeta), '# Lens: check\n\nfind the bugs');
  const p = buildLensPrompt(LENSES[0], ['a.js'], { definition: withMeta });
  assert.match(p, /# Lens: check/);
  assert.doesNotMatch(p, /when: \[/, 'routing globs must not reach the model');
  assert.doesNotMatch(p, /cites:/);
});

test('a definition with no body beyond frontmatter is an error', () => {
  assert.throws(
    () => buildLensPrompt(LENSES[0], ['a.js'],
      { definition: '---\nname: check\n---\n' }),
    /no body to adopt/);
});

test('a document without frontmatter passes through unchanged', () => {
  assert.equal(stripFrontmatter('# Lens\n\nbody'), '# Lens\n\nbody');
});

test('files matching no lens are reported, not silently dropped', () => {
  const { roster, unmatched } = planRun(LENSES,
    ['lib/a.js', 'app/x.jsx', 'src/styles.css', 'README.md']);
  assert.deepEqual(roster.map(l => l.name).sort(), ['check', 'ux']);
  assert.deepEqual(unmatched, ['src/styles.css', 'README.md'],
    'a file no lens will read is a coverage hole and must surface');
});

test('unmatched accounts for lenses removed by --only', () => {
  const { unmatched } = planRun(LENSES, ['lib/a.js', 'app/x.jsx'],
    { only: ['check'] });
  assert.deepEqual(unmatched, ['app/x.jsx'],
    'excluding ux leaves its file unreviewed, and that must be said');
});

test('nothing is unmatched when every file is covered', () => {
  assert.deepEqual(planRun(LENSES, ['lib/a.js']).unmatched, []);
});

// --- diff-scoped prompts ---

test('changed line ranges appear beside each file', () => {
  const p = buildLensPrompt(LENSES[0], ['lib/a.js', 'lib/b.js'], {
    definition: 'x',
    rangesByFile: { 'lib/a.js': [[5, 7], [24, 24]] }
  });
  assert.match(p, /- lib\/a\.js {2}\(changed lines: 5-7, 24\)/);
  assert.match(p, /- lib\/b\.js$/m, 'a file with no ranges is listed plainly');
});

test('a diff review says the change is the priority, not the boundary', () => {
  const p = buildLensPrompt(LENSES[0], ['lib/a.js'], {
    definition: 'x', rangesByFile: { 'lib/a.js': [[5, 7]] }
  });
  assert.match(p, /review of a change/);
  assert.match(p, /still worth\s+reporting when the change causes it/,
    'a defect the change breaks elsewhere must remain reportable');
});

test('without ranges the prompt says nothing about diffs', () => {
  const p = buildLensPrompt(LENSES[0], ['lib/a.js'], { definition: 'x' });
  assert.doesNotMatch(p, /review of a change/);
  assert.doesNotMatch(p, /changed lines/);
});

// --- verification pass ---

test('the refute prompt sends the skeptic to the file, not the claim', () => {
  const p = buildRefutePrompt({
    file: 'lib/a.js', line: 12, issue: 'quota of 0 treated as absent',
    fix: 'use ??'
  });
  assert.match(p, /REFUTE it/);
  assert.match(p, /lib\/a\.js:12/);
  assert.match(p, /Do not take the claim's description of the code as accurate/);
  assert.match(p, /Default to refuted/);
  assert.match(p, /REFUTED —/);
  assert.match(p, /CONFIRMED —/);
});

test('a refute prompt needs a finding with a file', () => {
  assert.throws(() => buildRefutePrompt({}), /requires a finding with a file/);
});

test('verdicts parse in both directions', () => {
  assert.deepEqual(parseVerdict('CONFIRMED — quota 0 reaches the branch'),
    { tested: true, refuted: false, reason: 'quota 0 reaches the branch' });
  const r = parseVerdict('REFUTED — the caller validates before this runs');
  assert.equal(r.refuted, true);
  assert.match(r.reason, /caller validates/);
});

test('a verdict buried in prose is still found', () => {
  assert.equal(parseVerdict('Let me check.\nCONFIRMED — real').refuted, false);
});

// Replaces an earlier test asserting the opposite. The refute prompt tells the
// MODEL to default to refuted when it cannot demonstrate the defect — a
// judgement reached after looking. A verifier that emitted nothing usable made
// no such judgement, and the tool treating the two identically dropped findings
// on the strength of an absent test. The same event reaching the tool as a
// non-zero exit already left the finding standing.
test('an unusable verdict is not a refutation, and does not claim a test ran', () => {
  for (const text of ['', 'I am not sure', undefined, 'maybe?']) {
    const v = parseVerdict(text);
    assert.equal(v.refuted, false, JSON.stringify(text));
    assert.equal(v.tested, false, JSON.stringify(text));
  }
  assert.match(parseVerdict('').reason, /no usable verdict/);
});

// --- per-lens exec ---

test('a lens can declare its own exec command', () => {
  assert.equal(resolveExec({ name: 'check', exec: 'cheap-model' }, 'default-model'),
    'cheap-model');
});

test('an exec map selects per lens, with a default fallback', () => {
  const map = { default: 'big', check: 'small' };
  assert.equal(resolveExec({ name: 'check' }, map), 'small');
  assert.equal(resolveExec({ name: 'taint' }, map), 'big');
});

test('a lens exec beats both the map and the default', () => {
  assert.equal(
    resolveExec({ name: 'check', exec: 'own' }, { check: 'mapped' }), 'own');
});

test('a plain string exec applies to every lens', () => {
  assert.equal(resolveExec({ name: 'anything' }, 'one-model'), 'one-model');
});

test('no exec anywhere resolves to null rather than a silent default', () => {
  assert.equal(resolveExec({ name: 'check' }, undefined), null);
  assert.equal(resolveExec({ name: 'check' }, { other: 'x' }), null);
});

// --- budget ---

test('a budget under the job count drops the remainder, and names them', () => {
  const jobs = [{ lens: 'a' }, { lens: 'b' }, { lens: 'c' }];
  const { run, dropped } = planBudget(jobs, 2);
  assert.deepEqual(run.map(j => j.lens), ['a', 'b']);
  assert.deepEqual(dropped.map(j => j.lens), ['c']);
});

test('a budget at or above the job count drops nothing', () => {
  const jobs = [{ lens: 'a' }, { lens: 'b' }];
  assert.deepEqual(planBudget(jobs, 2).dropped, []);
  assert.deepEqual(planBudget(jobs, 99).dropped, []);
  assert.deepEqual(planBudget(jobs, null).dropped, []);
});

test('a zero budget runs nothing and says so', () => {
  const jobs = [{ lens: 'a' }];
  const { run, dropped } = planBudget(jobs, 0);
  assert.deepEqual(run, []);
  assert.equal(dropped.length, 1);
});

test('dropped lenses are reported by runPanel, never silently omitted', async () => {
  const many = Array.from({ length: 4 }, (_, i) => ({
    name: `l${i}`, when: ['**/*.js'], owns: 'o', 'not-owns': 'n', definition: 'd'
  }));
  const { roster } = planRun(many, ['a.js']);
  const result = await runPanel({
    roster, maxDispatches: 2, exec: okExec('NO FINDINGS')
  });
  assert.equal(result.reports.length, 2);
  assert.equal(result.dropped.length, 2);
  assert.ok(result.dropped.every(d => d.lens && typeof d.files === 'number'));
});

// --- caching ---

test('a cache hit skips the executor entirely', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js']);
  const store = new Map();
  const cache = createCache({
    read: k => store.get(k) ?? null, write: (k, e) => store.set(k, e)
  });
  const keyFor = () => 'fixed-key';
  let calls = 0;
  const counting = async () => {
    calls += 1;
    return { stdout: 'lib/a.js:4 — BLOCK — boom — fix', code: 0 };
  };
  const first = await runPanel({ roster, exec: counting, cache, cacheKeyFor: keyFor });
  const second = await runPanel({ roster, exec: counting, cache, cacheKeyFor: keyFor });
  assert.equal(calls, 1, 'the second run must not dispatch');
  assert.equal(second.reports[0].findings.length, 1);
  assert.equal(first.cacheStats.writes, 1);
  assert.equal(second.cacheStats.hits, 1);
});

test('a failed lens is not cached, so it is retried next run', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js']);
  const store = new Map();
  const cache = createCache({
    read: k => store.get(k) ?? null, write: (k, e) => store.set(k, e)
  });
  await runPanel({
    roster, exec: async () => ({ stdout: '', code: 1 }),
    cache, cacheKeyFor: () => 'k'
  });
  assert.equal(store.size, 0, 'caching a failure would make it permanent');
});

test('with no cache configured everything dispatches as before', async () => {
  const { roster } = planRun(LENSES, ['lib/a.js']);
  let calls = 0;
  const counting = async () => { calls += 1; return { stdout: 'NO FINDINGS', code: 0 }; };
  await runPanel({ roster, exec: counting });
  await runPanel({ roster, exec: counting });
  assert.equal(calls, 2);
});
