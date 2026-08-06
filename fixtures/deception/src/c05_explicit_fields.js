/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

const EDITABLE = ['displayName', 'timezone', 'locale'];

export function applyPrefs(user, req) {
  const prefs = req.body.prefs || {};
  for (const key of EDITABLE) {
    if (Object.hasOwn(prefs, key)) {
      user[key] = String(prefs[key]);
    }
  }
  return user;
}
