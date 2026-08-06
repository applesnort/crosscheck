/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

export function applyPrefs(user, req) {
  const prefs = req.body.prefs || {};
  for (const key of Object.keys(prefs)) {
    user[key] = prefs[key];
  }
  return user;
}
