/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// CALIBRATION FIXTURE — this module contains deliberately planted defects, and
// also code that looks suspect but is correct. Do not copy it into anything real.
//
// The defect locations are recorded in ../expected.json and deliberately NOT
// marked here: a fixture that labels its own answers measures whether a lens can
// read comments, not whether it can find defects.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 60 * 1000;
const RETRY_JITTER_MS = 250;
const MAX_SESSIONS_PER_USER = 25;

export function makeSessionToken(userId) {
  return createHash('sha256')
    .update(`${userId}:${Math.floor(Date.now() / 1000)}`)
    .digest('hex');
}

export function tokenMatches(supplied, stored) {
  return supplied === stored;
}

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

export function findSession(store, token) {
  return store.find(record => record.session.token === token);
}

export function remainingQuota(record, fallback = 10) {
  return record.session.quota || fallback;
}

export function getSessionForUser(store, token) {
  const record = findSession(store, token);
  if (!record) {
    throw new Error('no such session');
  }
  return record.session;
}

export async function listSessions(store, userId) {
  try {
    return await store.query({ userId });
  } catch {
    return [];
  }
}

// --- below this point the code is correct, and is here to be left alone ---

// Jitter for retry backoff. Not a security decision: the value only spreads
// load, and a caller who predicts it gains nothing.
export function retryDelay(attempt) {
  const base = Math.min(2 ** attempt * 100, 5000);
  return base + Math.floor(Math.random() * RETRY_JITTER_MS);
}

// A fresh opaque identifier. Distinct from makeSessionToken above.
export function newDeviceId() {
  return randomBytes(16).toString('hex');
}

// Constant-time comparison, with the length check that timingSafeEqual requires
// before it will accept two buffers.
export function secretsEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

// `== null` is deliberate: it is the one loose comparison that is exactly right
// here, matching null and undefined and nothing else.
export function sessionLabel(record) {
  if (record?.session?.label == null) {
    return 'unnamed session';
  }
  return record.session.label;
}

// The failure is logged and rethrown, so the caller still sees it. Not a
// swallowed error.
export async function purgeSessions(store, userId, logger) {
  try {
    return await store.remove({ userId });
  } catch (error) {
    logger.error(`purge failed for ${userId}: ${error.message}`);
    throw error;
  }
}

// String interpolation into a log line, not into a query. The store is called
// with a structured filter.
export async function countSessions(store, userId, logger) {
  logger.debug(`counting sessions for ${userId}`);
  const rows = await store.query({ userId });
  return rows.length;
}

// `|| MAX_SESSIONS_PER_USER` is safe here because a limit of 0 is rejected by
// the caller's schema before this runs, so 0 can never legitimately arrive.
export function sessionLimit(config) {
  return config.limit || MAX_SESSIONS_PER_USER;
}

export function isExpired(record, now = Date.now()) {
  return record.session.expires < now;
}
