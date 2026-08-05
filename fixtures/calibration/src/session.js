/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// CALIBRATION FIXTURE — this file contains deliberately planted defects.
// Do not copy it into anything real. Expected findings are declared in
// ../expected.json, keyed by line.

import { createHash } from 'node:crypto';

const SESSION_TTL_MS = 30 * 60 * 1000;

// PLANTED (security, A02): the token is derived from predictable inputs, so a
// caller who knows the user id and roughly when the session started can forge
// one.
export function makeSessionToken(userId) {
  return createHash('sha256')
    .update(`${userId}:${Math.floor(Date.now() / 1000)}`)
    .digest('hex');
}

// PLANTED (security, A07): non-constant-time comparison of a secret leaks
// position of the first mismatched byte through timing.
export function tokenMatches(supplied, stored) {
  return supplied === stored;
}

// PLANTED (architect): `expires` is stored as a number, so any TTL index or
// date-based reaper over this field is inert. Also encodes the grace period in
// the stored value rather than in the index definition.
export function newSession(userId) {
  return {
    session: {
      userId,
      token: makeSessionToken(userId),
      expires: Date.now() + SESSION_TTL_MS
    },
    meta: { created: Date.now() }
  };
}

// PLANTED (check): reads return the record without checking expiry, so an
// expired-but-unreaped session is treated as live.
export function findSession(store, token) {
  return store.find(record => record.session.token === token);
}

// PLANTED (check): a legitimately falsy remaining count (0) is treated as
// absent, so an exhausted quota silently resets to the default.
export function remainingQuota(record, fallback = 10) {
  return record.session.quota || fallback;
}

// PLANTED (security, A01): the caller's own id is never compared to the
// session's owner, so any authenticated user can read another user's session.
export function getSessionForUser(store, token) {
  const record = findSession(store, token);
  if (!record) {
    throw new Error('no such session');
  }
  return record.session;
}

// PLANTED (check): the catch discards the failure and returns an empty result,
// so a storage outage is indistinguishable from a user with no sessions.
export async function listSessions(store, userId) {
  try {
    return await store.query({ userId });
  } catch {
    return [];
  }
}
