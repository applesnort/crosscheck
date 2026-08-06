/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

// `query` here is an array filter over data already in memory. Nothing is
// parsed, compiled, or executed.
export function searchLoaded(records, req) {
  const term = String(req.query.q ?? '').toLowerCase();
  return records.filter(r => r.name.toLowerCase().includes(term));
}
