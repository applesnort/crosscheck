/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { execFile } from 'node:child_process';

export function pingHost(req, res) {
  const host = req.body.host;
  execFile('ping', ['-c', '1', '--', host], (err, stdout) => res.end(stdout));
}
