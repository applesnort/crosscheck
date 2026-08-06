/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCS = '/srv/docs';

export function readDoc(req, res) {
  const name = req.query.name;
  res.end(readFileSync(join(DOCS, name), 'utf8'));
}
