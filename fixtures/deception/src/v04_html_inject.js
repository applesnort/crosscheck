/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

export function renderGreeting(req, res) {
  const who = req.query.name;
  res.setHeader('content-type', 'text/html');
  res.end(`<div class="greeting">Hello, ${who}!</div>`);
}
