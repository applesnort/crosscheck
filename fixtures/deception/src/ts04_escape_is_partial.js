/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

import { escapeHtml } from './helpers/sanitize.js';

export function renderProfile(req, res) {
  const nickname = escapeHtml(req.query.nickname);
  res.setHeader('content-type', 'text/html');
  res.end(`<img src="/avatar.png" alt="${nickname}">`);
}
