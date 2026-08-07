/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CACHE_VERSION,
  cacheKey,
  createCache,
  digest,
  isUsableEntry,
  makeEntry
} from '../lib/cache.mjs';

const base = {
  lens: 'check',
  definition: '# check\n\nfind bugs',
  files: [{ path: 'a.js', content: 'const x = 1;' }],
  promptOptions: {}
};

test('the same inputs produce the same key', () => {
  assert.equal(cacheKey(base), cacheKey({ ...base }));
});

test('changed file content changes the key', () => {
  const other = { ...base, files: [{ path: 'a.js', content: 'const x = 2;' }] };
  assert.notEqual(cacheKey(base), cacheKey(other));
});

test('editing the lens invalidates its cached results', () => {
  // The whole point: a cache surviving a prompt edit would serve answers from
  // the previous lens with no way to tell.
  const edited = { ...base, definition: '# check\n\nfind bugs, and also X' };
  assert.notEqual(cacheKey(base), cacheKey(edited));
});

test('a different lens over the same file gets a different key', () => {
  assert.notEqual(cacheKey(base), cacheKey({ ...base, lens: 'taint' }));
});

test('a different file set changes the key', () => {
  const more = {
    ...base,
    files: [...base.files, { path: 'b.js', content: 'const y = 1;' }]
  };
  assert.notEqual(cacheKey(base), cacheKey(more));
});

test('file order is part of the key, since prompts list files in order', () => {
  const files = [
    { path: 'a.js', content: '1' }, { path: 'b.js', content: '2' }
  ];
  assert.notEqual(
    cacheKey({ ...base, files }),
    cacheKey({ ...base, files: [...files].reverse() }));
});

test('prompt options change the key', () => {
  assert.notEqual(
    cacheKey(base),
    cacheKey({ ...base, promptOptions: { mixedCorpus: true } }));
  assert.notEqual(
    cacheKey(base),
    cacheKey({ ...base, promptOptions: { rangesByFile: { 'a.js': [[1, 4]] } } }));
});

test('the digest does not collide on shifted separators', () => {
  assert.notEqual(digest(['ab', 'c']), digest(['a', 'bc']));
});

test('a key requires a lens name', () => {
  assert.throws(() => cacheKey({ ...base, lens: undefined }),
    /requires a lens name/);
});

// --- entries ---

test('an entry round-trips and validates', () => {
  const key = cacheKey(base);
  const entry = makeEntry({ key, lens: 'check', output: 'NO FINDINGS' });
  assert.equal(entry.version, CACHE_VERSION);
  assert.equal(isUsableEntry(entry, key), true);
});

test('an entry for a different key is rejected', () => {
  const entry = makeEntry({ key: 'aaaa', lens: 'check', output: 'x' });
  assert.equal(isUsableEntry(entry, 'bbbb'), false);
});

test('an entry from an older cache format is rejected', () => {
  const entry = { ...makeEntry({ key: 'k', lens: 'c', output: 'x' }), version: 0 };
  assert.equal(isUsableEntry(entry, 'k'), false);
});

test('an empty or malformed entry is rejected rather than served', () => {
  assert.equal(isUsableEntry(null, 'k'), false);
  assert.equal(isUsableEntry({ key: 'k', version: CACHE_VERSION }, 'k'), false);
  assert.equal(
    isUsableEntry(makeEntry({ key: 'k', lens: 'c', output: '' }), 'k'), false,
    'an empty output is exactly what a failed lens produces');
});

// --- the cache object ---

test('a hit returns the stored output and is counted', () => {
  const store = new Map();
  const cache = createCache({
    read: k => store.get(k) ?? null,
    write: (k, e) => store.set(k, e)
  });
  cache.set('k1', 'check', 'a.js:1 — BLOCK — x — y');
  assert.equal(cache.get('k1', 'check'), 'a.js:1 — BLOCK — x — y');
  assert.equal(cache.stats.hits, 1);
  assert.equal(cache.stats.writes, 1);
  assert.deepEqual(cache.stats.hitLenses, ['check']);
});

test('a miss returns null and is counted', () => {
  const cache = createCache({ read: () => null, write: () => {} });
  assert.equal(cache.get('nope', 'check'), null);
  assert.equal(cache.stats.misses, 1);
  assert.equal(cache.stats.hits, 0);
});

test('a disabled cache never hits and reports itself disabled', () => {
  const cache = createCache();
  assert.equal(cache.enabled, false);
  cache.set('k', 'check', 'out');
  assert.equal(cache.get('k', 'check'), null);
  assert.equal(cache.stats.hits, 0);
  assert.equal(cache.stats.writes, 0);
});

test('an empty output is never stored', () => {
  const store = new Map();
  const cache = createCache({ read: k => store.get(k), write: (k, e) => store.set(k, e) });
  cache.set('k', 'check', '');
  assert.equal(store.size, 0, 'a failed lens must not poison the cache');
});
