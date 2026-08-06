/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { db } from './db.js';

export async function pageOrders(req) {
  const page = Number.parseInt(req.query.page, 10);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) {
    throw new Error('bad page');
  }
  const offset = page * 50;
  return db.raw(`SELECT * FROM orders LIMIT 50 OFFSET ${offset}`);
}
