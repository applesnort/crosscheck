/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { db } from './db.js';

export async function findOrder(req) {
  const id = req.query.orderId;
  return db.query('SELECT * FROM orders WHERE id = ?', [id]);
}
