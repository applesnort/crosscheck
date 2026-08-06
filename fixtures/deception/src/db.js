/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

export const db = {
  async raw(sql) { return { sql }; },
  async query(sql, params) { return { sql, params }; }
};
