/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyVerdicts,
  consensusScore,
  countsBySeverity,
  findingKey,
  higherSeverity,
  lensOverlap,
  mergeFindings,
  normalizeSeverity,
  panelVerdict
} from '../lib/merge.mjs';

const at = (file, line, severity, issue, fix = 'fix it') =>
  ({ file, line, severity, issue, fix });

test('top-tier vocabulary from any lens normalizes to BLOCK', () => {
  for (const raw of [
    'block', 'blocker', 'must-fix', 'must fix', 'critical', 'violation',
    'data-corrupting', 'invisible-failure', 'HIGH', 'error', '[BLOCK]'
  ]) {
    assert.equal(normalizeSeverity(raw), 'BLOCK', raw);
  }
});

test('middle tier normalizes to FIX, everything else to CONSIDER', () => {
  for (const raw of ['fix', 'should-fix', 'warning', 'medium', 'moderate']) {
    assert.equal(normalizeSeverity(raw), 'FIX', raw);
  }
  for (const raw of ['nit', 'consider', 'low', 'fyi', '', undefined]) {
    assert.equal(normalizeSeverity(raw), 'CONSIDER', String(raw));
  }
});

test('severity conflicts resolve to the highest tier, not first or last', () => {
  assert.equal(higherSeverity('CONSIDER', 'BLOCK'), 'BLOCK');
  assert.equal(higherSeverity('BLOCK', 'CONSIDER'), 'BLOCK');
  assert.equal(higherSeverity('FIX', 'CONSIDER'), 'FIX');
});

test('two lenses phrasing one defect differently collapse to one finding', () => {
  const a = at('lib/a.js', 41, 'blocker', 'expires stored as a number');
  const b = at('lib/a.js', 41, 'warning', 'Expires stored as a number!');
  assert.equal(findingKey(a), findingKey(b));
  const { findings } = mergeFindings([
    { lens: 'check', findings: [a] },
    { lens: 'architect', findings: [b] }
  ]);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].lenses, ['check', 'architect']);
  assert.equal(findings[0].consensus, true);
  assert.equal(findings[0].severity, 'BLOCK');
});

test('a consensus finding upgrades when the higher severity arrives second', () => {
  const { findings } = mergeFindings([
    { lens: 'architect',
      findings: [at('lib/a.js', 41, 'warning', 'expires is a number')] },
    { lens: 'check',
      findings: [at('lib/a.js', 41, 'blocker', 'Expires is a number!')] }
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'BLOCK');
});

test('a missing fix is filled in from whichever lens supplied one', () => {
  const { findings } = mergeFindings([
    { lens: 'check', findings: [
      { file: 'lib/a.js', line: 3, severity: 'FIX', issue: 'same', fix: null }
    ] },
    { lens: 'ux', findings: [at('lib/a.js', 3, 'FIX', 'same', 'do this')] }
  ]);
  assert.equal(findings[0].fix, 'do this');
});

test('the same lens reporting twice does not fake consensus', () => {
  const { findings } = mergeFindings([
    { lens: 'check', findings: [
      at('lib/a.js', 41, 'blocker', 'dupe'),
      at('lib/a.js', 41, 'blocker', 'dupe')
    ] }
  ]);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].lenses, ['check']);
  assert.equal(findings[0].consensus, false);
  assert.equal(findings[0].consensusScore, 1);
});

test('an escalation policy can raise severity but is not required', () => {
  const escalate = (f, sev) => /secret/i.test(f.issue) ? 'BLOCK' : sev;
  const reports = [{ lens: 'check', findings: [
    at('lib/a.js', 7, 'nit', 'logs the secret on failure'),
    at('lib/a.js', 8, 'nit', 'variable name is vague')
  ] }];
  const withPolicy = mergeFindings(reports, { escalate });
  assert.equal(withPolicy.findings.find(f => f.line === 7).severity, 'BLOCK');
  assert.equal(withPolicy.findings.find(f => f.line === 8).severity, 'CONSIDER');
  const without = mergeFindings(reports);
  assert.equal(without.findings.find(f => f.line === 7).severity, 'CONSIDER',
    'no policy means no escalation — the library has no opinions of its own');
});

test('a dead lens surfaces in incomplete and is never counted as clean', () => {
  const { findings, incomplete } = mergeFindings([
    { lens: 'check', findings: [at('lib/a.js', 41, 'blocker', 'real')] },
    { lens: 'ux', findings: null },
    null
  ]);
  assert.equal(findings.length, 1);
  assert.deepEqual(incomplete, ['ux', '<unknown>']);
});

test('a lens with genuinely nothing to report is complete', () => {
  const { findings, incomplete } = mergeFindings([{ lens: 'ux', findings: [] }]);
  assert.deepEqual(findings, []);
  assert.deepEqual(incomplete, []);
});

test('unparsed lens output is carried through the merge', () => {
  const { unparsed } = mergeFindings([
    { lens: 'ux', findings: [], unparsed: ['Here is my summary:'] }
  ]);
  assert.deepEqual(unparsed, [{ lens: 'ux', line: 'Here is my summary:' }]);
});

// --- consensus scoring ---

test('consensus score counts effective independent confirmations', () => {
  assert.equal(consensusScore(['check']), 1, 'one lens is one confirmation');
  assert.equal(consensusScore(['check', 'ux']), 2,
    'unmeasured pairs are treated as independent');
});

test('redundant lenses agreeing scores lower than distant ones', () => {
  // check and security-check both look at injection; ux and architect do not
  // overlap at all.
  const overlap = { 'check|security-check': 1, 'architect|ux': 0 };
  const redundant = consensusScore(['check', 'security-check'], overlap);
  const distant = consensusScore(['architect', 'ux'], overlap);
  assert.equal(redundant, 1, 'fully redundant agreement adds nothing');
  assert.equal(distant, 2);
  assert.ok(distant > redundant);
});

test('partial overlap scores between redundant and independent', () => {
  const score = consensusScore(['check', 'ux'], { 'check|ux': 0.5 });
  assert.equal(score, 1.5);
});

test('overlap is order-independent', () => {
  const overlap = { 'check|ux': 0.25 };
  assert.equal(consensusScore(['check', 'ux'], overlap),
    consensusScore(['ux', 'check'], overlap));
});

test('three lenses accumulate over every distinct pair', () => {
  const overlap = { 'a|b': 0, 'a|c': 0, 'b|c': 0 };
  assert.equal(consensusScore(['a', 'b', 'c'], overlap), 4);
});

test('a duplicated lens name cannot inflate the score', () => {
  assert.equal(consensusScore(['check', 'check']), 1);
});

test('lensOverlap measures Jaccard overlap from real reports', () => {
  const shared = at('lib/a.js', 1, 'FIX', 'same issue');
  const overlap = lensOverlap([
    { lens: 'check', findings: [shared, at('lib/a.js', 2, 'FIX', 'only check')] },
    { lens: 'ux', findings: [shared] },
    { lens: 'dead', findings: null }
  ]);
  // union of 2 keys, 1 shared
  assert.equal(overlap['check|ux'], 0.5);
  assert.ok(!('check|dead' in overlap), 'a dead lens contributes no overlap');
});

test('merged findings are ranked by severity then consensus strength', () => {
  const overlap = { 'check|security-check': 1, 'architect|ux': 0 };
  const { findings } = mergeFindings([
    { lens: 'check', findings: [at('lib/r.js', 1, 'blocker', 'redundant pair')] },
    { lens: 'security-check',
      findings: [at('lib/r.js', 1, 'blocker', 'redundant pair')] },
    { lens: 'architect', findings: [at('lib/d.js', 2, 'blocker', 'distant pair')] },
    { lens: 'ux', findings: [at('lib/d.js', 2, 'blocker', 'distant pair')] },
    { lens: 'check', findings: [at('lib/z.js', 3, 'nit', 'minor')] }
  ], { overlap });
  assert.equal(findings[0].file, 'lib/d.js',
    'independent confirmation outranks redundant confirmation');
  assert.equal(findings[0].consensusScore, 2);
  assert.equal(findings[1].consensusScore, 1);
  assert.equal(findings.at(-1).severity, 'CONSIDER');
});

// --- verdicts, counts, verdict line ---

test('refuted findings are removed and returned, not silently dropped', () => {
  const { findings } = mergeFindings([
    { lens: 'check', findings: [
      at('lib/a.js', 1, 'blocker', 'real'),
      at('lib/a.js', 2, 'blocker', 'false positive')
    ] }
  ]);
  const target = findings.find(f => f.issue === 'false positive');
  const result = applyVerdicts(findings, {
    [target.key]: { refuted: true, reason: 'guarded upstream' }
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].issue, 'real');
  assert.equal(result.refuted.length, 1);
  assert.equal(result.refuted[0].refutedReason, 'guarded upstream');
});

test('a finding with no verdict survives the verify pass', () => {
  const { findings } = mergeFindings([
    { lens: 'check', findings: [at('lib/a.js', 1, 'blocker', 'real')] }
  ]);
  assert.equal(applyVerdicts(findings, {}).findings.length, 1);
  assert.equal(applyVerdicts(findings, undefined).findings.length, 1);
});

test('counts and verdict follow the highest severity present', () => {
  const mk = sev => ({ severity: sev });
  assert.deepEqual(countsBySeverity([mk('BLOCK'), mk('FIX'), mk('FIX')]),
    { BLOCK: 1, FIX: 2, CONSIDER: 0 });
  assert.match(panelVerdict({ BLOCK: 1, FIX: 0, CONSIDER: 0 }), /Do not ship/);
  assert.match(panelVerdict({ BLOCK: 0, FIX: 2, CONSIDER: 0 }), /Fix before merge/);
  assert.equal(panelVerdict({ BLOCK: 0, FIX: 0, CONSIDER: 3 }), 'Ship');
});

test('merging nothing is empty, not a crash', () => {
  for (const input of [[], undefined, null]) {
    const r = mergeFindings(input);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.incomplete, []);
  }
});
