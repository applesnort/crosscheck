/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { readFileSync } from 'node:fs';

const TEMPLATE = '/srv/templates/invoice.html';

export function readTemplate() {
  return readFileSync(TEMPLATE, 'utf8');
}
