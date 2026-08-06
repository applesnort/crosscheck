/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { exec } from 'node:child_process';

// The only values that can reach the command are these three constants.
const REPORTS = {
  daily: '/srv/reports/daily.sh',
  weekly: '/srv/reports/weekly.sh',
  monthly: '/srv/reports/monthly.sh'
};

export function runReport(req, res) {
  const script = REPORTS[req.query.kind];
  if (!script) {
    res.statusCode = 400;
    return res.end('unknown report');
  }
  exec(`sh ${script}`, (err, stdout) => res.end(stdout));
}
