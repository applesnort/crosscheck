/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Result cache.
//
// A panel that re-reviews unchanged files on every run costs money for nothing,
// and a tool that costs money for nothing gets switched off. Caching is keyed on
// everything that could change the answer: the lens definition, the files, their
// contents, and the prompt options.
//
// The lens definition is part of the key on purpose. Editing a lens must
// invalidate its cached results — a cache that survives a prompt change would
// quietly serve answers from the old lens and there would be no way to tell.
//
// Pure key computation; IO is injected so this is testable without a disk.

// FNV-1a over the inputs. Not cryptographic: it only has to distinguish inputs
// within one project, and a collision costs a stale result rather than a
// security failure.
export function digest(parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    }
    // Separator, so ['ab','c'] and ['a','bc'] do not collide.
    h = Math.imul(h ^ 0x1f, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const CACHE_VERSION = 1;

// files: [{path, content}] in the order the lens will see them.
export function cacheKey({ lens, definition, files, promptOptions = {} }) {
  if (!lens) {
    throw new Error('cacheKey requires a lens name');
  }
  return digest([
    `v${CACHE_VERSION}`,
    lens,
    // The definition body decides what the lens does, so it decides the answer.
    definition ?? '',
    ...(files ?? []).flatMap(f => [f.path, f.content ?? '']),
    JSON.stringify(promptOptions ?? {})
  ]);
}

// entry: {key, lens, output, storedAt}
export function isUsableEntry(entry, key) {
  return Boolean(
    entry &&
    entry.key === key &&
    entry.version === CACHE_VERSION &&
    typeof entry.output === 'string' &&
    entry.output.length > 0);
}

export function makeEntry({ key, lens, output, now }) {
  return {
    version: CACHE_VERSION,
    key,
    lens,
    // Recorded for a human reading the cache directory, not used for matching.
    storedAt: now ?? null,
    output
  };
}

// A cache wired to injected IO. `read` returns a parsed entry or null; `write`
// persists one. Both may be omitted to disable caching entirely, which is what
// --no-cache does.
export function createCache({ read = null, write = null } = {}) {
  const stats = { hits: 0, misses: 0, writes: 0, hitLenses: [] };
  return {
    stats,
    enabled: Boolean(read || write),
    get(key, lens) {
      if (!read) {
        return null;
      }
      const entry = read(key);
      if (isUsableEntry(entry, key)) {
        stats.hits += 1;
        stats.hitLenses.push(lens);
        return entry.output;
      }
      stats.misses += 1;
      return null;
    },
    set(key, lens, output, now = null) {
      if (!write || !output) {
        return;
      }
      write(key, makeEntry({ key, lens, output, now }));
      stats.writes += 1;
    }
  };
}
