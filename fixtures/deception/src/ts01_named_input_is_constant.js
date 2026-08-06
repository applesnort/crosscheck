/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { db } from './db.js';
import { RequestValues } from './helpers/requestValues.js';

export async function findWidget(req) {
  const values = new RequestValues(req);
  const kind = values.getUserInput('widgetKind');
  return db.raw(`SELECT * FROM widgets WHERE kind = '${kind}'`);
}
