/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const DOCS = '/srv/docs';

export function readDoc(req, res) {
  const requested = req.query.name;
  const safe = basename(requested);
  res.end(readFileSync(join(DOCS, safe), 'utf8'));
}
