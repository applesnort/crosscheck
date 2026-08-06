/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { db } from './db.js';
import { sanitize } from './helpers/sanitize.js';

export async function findCustomer(req) {
  const name = sanitize(req.query.name);
  return db.raw(`SELECT * FROM customers WHERE name = '${name}'`);
}
