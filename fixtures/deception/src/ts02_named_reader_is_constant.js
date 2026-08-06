/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { exec } from 'node:child_process';
import { RequestValues } from './helpers/requestValues.js';

export function tailLog(req, res) {
  const values = new RequestValues(req);
  const target = values.readParam('logName');
  exec(`tail -n 50 ${target}`, (err, stdout) => res.end(stdout));
}
