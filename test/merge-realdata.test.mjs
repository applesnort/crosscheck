/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Regression tests built from ACTUAL lens output, not hand-written phrasing.
//
// The exact-key merge these replace passed every unit test and reported zero
// consensus on real data, because those tests used issue text I wrote myself
// with near-identical wording. Two lenses never phrase a defect the same way.
// Every string below is verbatim from a real run against the calibration
// fixture, so the thresholds stay honest when the matching logic is touched.
//
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  issueSimilarity,
  mergeFindings,
  sameFinding
} from '../lib/merge.mjs';

const FILE = 'fixtures/calibration/src/session.js';

// Pairs that describe the SAME defect and must merge.
const SAME = [
  { label: 'predictable token: check vs security-check',
    a: { line: 19, issue: 'makeSessionToken hashes only userId + the current second, so two calls for the same user within the same second produce identical tokens; findSession/getSessionForUser then cannot distinguish the two sessions' },
    b: { line: 19, issue: 'makeSessionToken derives the session token as sha256(userId + current-time-in-seconds) with no secret or entropy; anyone who guesses a valid userId can compute a matching token within the same 1-second window and hijack that session' } },
  { label: 'predictable token: check vs architect, two lines apart',
    a: { line: 19, issue: 'makeSessionToken hashes only userId + the current second, so two calls for the same user within the same second produce identical tokens' },
    b: { line: 17, issue: 'makeSessionToken derives the token only from userId and Date.now() truncated to the second, no randomness, so two sessions opened for the same user in the same second get the identical token' } },
  { label: 'falsy quota: check vs security-check',
    a: { line: 43, issue: 'record.session.quota || fallback treats a legitimately-zero quota the same as a missing one, so a session that has exhausted its quota is reported as having the fallback remaining' },
    b: { line: 43, issue: 'remainingQuota returns record.session.quota || fallback, so a session whose quota was explicitly set to 0 is silently granted the fallback' } },
  { label: 'swallowed error: check vs architect, two lines apart',
    a: { line: 56, issue: 'listSessions swallows every store.query failure and returns [], so a caller cannot tell user has no sessions from the query errored' },
    b: { line: 54, issue: 'listSessions catches any store failure and returns [], collapsing store errored into user has no sessions' } }
];

// Pairs that share a line but describe DIFFERENT defects, and must stay apart.
const DIFFERENT = [
  { label: 'timing side channel vs nullish comparison, both line 24',
    a: { line: 24, issue: 'tokenMatches compares secret tokens with === instead of a constant-time comparison, the same timing side-channel as findSession' },
    b: { line: 24, issue: 'tokenMatches uses ===, so when both supplied and stored are undefined it returns true, incorrectly reporting a match' } },
  { label: 'unenforced expiry vs split store contract, both line 38',
    a: { line: 38, issue: 'findSession/getSessionForUser never call isExpired before handing back a record, so the expiry lifecycle is defined but not enforced at the read boundary' },
    b: { line: 38, issue: 'findSession queries the store with a raw JS predicate while siblings use a structured filter, so the store contract is split and this function cannot be served by an index' } }
];

const withFile = f => ({ file: FILE, severity: 'BLOCK', fix: 'fix it', ...f });

test('real same-defect pairs score above the threshold', () => {
  for (const { label, a, b } of SAME) {
    const score = issueSimilarity(a.issue, b.issue);
    assert.ok(score >= DEFAULT_SIMILARITY_THRESHOLD,
      `${label}: scored ${score}, below threshold ${DEFAULT_SIMILARITY_THRESHOLD}`);
  }
});

test('real different-defect pairs score below the threshold', () => {
  for (const { label, a, b } of DIFFERENT) {
    const score = issueSimilarity(a.issue, b.issue);
    assert.ok(score < DEFAULT_SIMILARITY_THRESHOLD,
      `${label}: scored ${score}, at or above threshold — would over-merge`);
  }
});

test('the two bands are separated, not merely ordered', () => {
  const same = SAME.map(p => issueSimilarity(p.a.issue, p.b.issue));
  const different = DIFFERENT.map(p => issueSimilarity(p.a.issue, p.b.issue));
  const lowestSame = Math.min(...same);
  const highestDifferent = Math.max(...different);
  assert.ok(lowestSame > highestDifferent * 2,
    `bands too close: same-defect low ${lowestSame} vs different-defect high ` +
    `${highestDifferent} — the threshold has no margin`);
  assert.ok(DEFAULT_SIMILARITY_THRESHOLD > highestDifferent &&
    DEFAULT_SIMILARITY_THRESHOLD < lowestSame,
    `threshold ${DEFAULT_SIMILARITY_THRESHOLD} must sit inside the gap ` +
    `(${highestDifferent}, ${lowestSame})`);
});

test('sameFinding merges real agreements and separates real distinctions', () => {
  for (const { label, a, b } of SAME) {
    assert.equal(sameFinding(withFile(a), withFile(b)), true, `same: ${label}`);
  }
  for (const { label, a, b } of DIFFERENT) {
    assert.equal(sameFinding(withFile(a), withFile(b)), false,
      `different: ${label}`);
  }
});

test('anchor drift beyond the tolerance does not merge', () => {
  const [, drift] = SAME;
  assert.equal(
    sameFinding(withFile(drift.a), withFile({ ...drift.b, line: 200 })), false,
    'same wording far apart in the file is not the same finding');
});

test('a three-lens agreement on one defect becomes one consensus finding', () => {
  // Verbatim from the workflow run: all three lenses found the swallowed error,
  // anchored at 54, 56, and 57. The exact-key merge reported these as three
  // separate findings and zero consensus.
  const { findings } = mergeFindings([
    { lens: 'check', findings: [withFile({ line: 56,
      issue: 'listSessions swallows every store.query failure and returns [], so a caller cannot tell user has no sessions from the query errored' })] },
    { lens: 'security-check', findings: [withFile({ line: 57,
      issue: 'listSessions swallows any store.query failure and returns [] with no logging, so a broken tenant-scope filter is indistinguishable from no sessions' })] },
    { lens: 'architect', findings: [withFile({ line: 54,
      issue: 'listSessions catches any store failure and returns [], collapsing store errored into user has no sessions' })] }
  ]);
  assert.equal(findings.length, 1, 'three anchors on one defect collapse to one');
  assert.equal(findings[0].consensus, true);
  assert.deepEqual(findings[0].lenses, ['check', 'security-check', 'architect']);
  assert.equal(findings[0].line, 54, 'reports the earliest anchor');
  assert.equal(findings[0].alsoReported.length, 2,
    'the other lenses\' phrasings are retained');
});

test('the merged anchor does not depend on lens order', () => {
  const mk = (lens, line, issue) => ({ lens, findings: [withFile({ line, issue })] });
  const issues = [
    'listSessions swallows every store.query failure and returns [], so a caller cannot tell user has no sessions from the query errored',
    'listSessions catches any store failure and returns [], collapsing store errored into user has no sessions'
  ];
  const forward = mergeFindings([mk('a', 56, issues[0]), mk('b', 54, issues[1])]);
  const reverse = mergeFindings([mk('b', 54, issues[1]), mk('a', 56, issues[0])]);
  assert.equal(forward.findings[0].line, 54);
  assert.equal(reverse.findings[0].line, 54);
});

test('two distinct defects on one line survive the merge as two findings', () => {
  const [distinct] = DIFFERENT;
  const { findings } = mergeFindings([
    { lens: 'security-check', findings: [withFile(distinct.a)] },
    { lens: 'check', findings: [withFile(distinct.b)] }
  ]);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(f => f.consensus === false),
    'neither may claim consensus — they are different defects');
});

test('an empty or whitespace issue never matches anything', () => {
  assert.equal(issueSimilarity('', 'anything at all here'), 0);
  assert.equal(issueSimilarity('the and for', 'a of to'), 0,
    'stopwords alone carry no signal');
});
