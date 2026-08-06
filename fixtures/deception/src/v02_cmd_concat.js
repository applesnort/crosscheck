/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { exec } from 'node:child_process';

export function pingHost(req, res) {
  const host = req.body.host;
  exec(`ping -c 1 ${host}`, (err, stdout) => res.end(stdout));
}
