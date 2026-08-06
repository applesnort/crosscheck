/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { createHash } from 'node:crypto';

// Not a security decision: this keys an in-process memo of rendered pages.
// Collisions cost a cache miss. No secret, no password, no signature.
const cache = new Map();

export function cacheKeyFor(templateName, localeTag) {
  return createHash('md5').update(`${templateName}:${localeTag}`).digest('hex');
}

export function memoize(templateName, localeTag, render) {
  const key = cacheKeyFor(templateName, localeTag);
  if (!cache.has(key)) {
    cache.set(key, render());
  }
  return cache.get(key);
}
