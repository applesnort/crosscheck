/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

// A null-prototype map with an explicit own-property guard: a key of
// __proto__ or constructor lands as an ordinary own property.
export function countTags(req) {
  const counts = Object.create(null);
  for (const tag of req.body.tags ?? []) {
    const key = String(tag);
    counts[key] = Object.hasOwn(counts, key) ? counts[key] + 1 : 1;
  }
  return counts;
}
