/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeFindings } from '../lib/merge.mjs';
import { fingerprint, sarifLevel, toSarif, toSarifJson } from '../lib/sarif.mjs';

const at = (file, line, severity, issue, fix = 'fix it') =>
  ({ file, line, severity, issue, fix });

const merged = (reports, options) => mergeFindings(reports, options);

test('severity maps onto SARIF result levels', () => {
  assert.equal(sarifLevel('BLOCK'), 'error');
  assert.equal(sarifLevel('FIX'), 'warning');
  assert.equal(sarifLevel('CONSIDER'), 'note');
  assert.equal(sarifLevel('anything else'), 'note');
});

test('emits a well-formed 2.1.0 envelope', () => {
  const sarif = toSarif(merged([
    { lens: 'check', findings: [at('lib/a.js', 41, 'blocker', 'bad')] }
  ]));
  assert.equal(sarif.version, '2.1.0');
  assert.match(sarif.$schema, /sarif-schema-2\.1\.0\.json$/);
  assert.equal(sarif.runs.length, 1);
  assert.equal(sarif.runs[0].tool.driver.name, 'crosscheck');
  assert.equal(sarif.runs[0].results.length, 1);
});

test('a result carries location, level, and message', () => {
  const [result] = toSarif(merged([
    { lens: 'check',
      findings: [at('lib/a.js', 41, 'blocker', 'expires is a number', 'use Date')] }
  ])).runs[0].results;
  assert.equal(result.level, 'error');
  assert.equal(result.ruleId, 'lens/check');
  assert.match(result.message.text, /expires is a number/);
  assert.match(result.message.text, /use Date/);
  const loc = result.locations[0].physicalLocation;
  assert.equal(loc.artifactLocation.uri, 'lib/a.js');
  assert.equal(loc.region.startLine, 41);
});

test('one rule per lens, sorted, with cited standards in properties', () => {
  const sarif = toSarif(merged([
    { lens: 'security-check', findings: [at('lib/a.js', 1, 'blocker', 'x')] },
    { lens: 'check', findings: [at('lib/b.js', 2, 'fix', 'y')] }
  ]), {
    lensMeta: {
      'security-check': {
        summary: 'application security', cites: ['OWASP Top 10 (2021)']
      }
    }
  });
  const rules = sarif.runs[0].tool.driver.rules;
  assert.deepEqual(rules.map(r => r.id), ['lens/check', 'lens/security-check']);
  assert.deepEqual(rules[1].properties.cites, ['OWASP Top 10 (2021)']);
  assert.equal(rules[1].shortDescription.text, 'application security');
  assert.ok(!rules[0].properties, 'no empty properties bag when there is no meta');
});

test('consensus rides along in properties, since SARIF has no concept for it', () => {
  const shared = at('lib/a.js', 41, 'blocker', 'same defect');
  const [result] = toSarif(merged([
    { lens: 'architect', findings: [shared] },
    { lens: 'ux', findings: [shared] }
  ], { overlap: { 'architect|ux': 0 } })).runs[0].results;
  assert.equal(result.properties.consensus, true);
  assert.equal(result.properties.consensusScore, 2);
  assert.deepEqual(result.properties.lenses, ['architect', 'ux']);
  assert.equal(result.properties.severity, 'BLOCK');
});

test('fingerprints are stable across runs and distinct across findings', () => {
  const a = at('lib/a.js', 41, 'blocker', 'expires is a number');
  const again = at('lib/a.js', 41, 'CONSIDER', 'expires is a number', 'other fix');
  assert.equal(fingerprint(a), fingerprint(again),
    'severity and fix do not change identity');
  assert.notEqual(fingerprint(a), fingerprint(at('lib/a.js', 42, 'blocker',
    'expires is a number')), 'line is part of identity');
  assert.notEqual(fingerprint(a), fingerprint(at('lib/b.js', 41, 'blocker',
    'expires is a number')), 'file is part of identity');
  assert.match(fingerprint(a), /^[0-9a-f]{16}$/);
});

test('fingerprints land in partialFingerprints for cross-run matching', () => {
  const f = at('lib/a.js', 41, 'blocker', 'bad');
  const [result] = toSarif(merged([{ lens: 'check', findings: [f] }]))
    .runs[0].results;
  assert.equal(result.partialFingerprints.crosscheckFindingV1, fingerprint(f));
});

test('an incomplete lens fails the invocation and is notified, not hidden', () => {
  const sarif = toSarif(merged([
    { lens: 'check', findings: [at('lib/a.js', 1, 'blocker', 'real')] },
    { lens: 'ux', findings: null }
  ]));
  const invocation = sarif.runs[0].invocations[0];
  assert.equal(invocation.executionSuccessful, false);
  const note = invocation.toolExecutionNotifications
    .find(n => n.descriptor.id === 'crosscheck/lensIncomplete');
  assert.equal(note.level, 'error');
  assert.equal(note.properties.lens, 'ux');
  assert.match(note.message.text, /did not complete/);
  assert.equal(sarif.runs[0].results.length, 1, 'findings still reported');
});

test('a complete panel reports a successful invocation', () => {
  const sarif = toSarif(merged([{ lens: 'check', findings: [] }]));
  assert.equal(sarif.runs[0].invocations[0].executionSuccessful, true);
  assert.deepEqual(sarif.runs[0].invocations[0].toolExecutionNotifications, []);
});

test('an incomplete lens still appears as a rule, so the gap is attributable', () => {
  const sarif = toSarif(merged([{ lens: 'ux', findings: null }]));
  assert.deepEqual(sarif.runs[0].tool.driver.rules.map(r => r.id), ['lens/ux']);
});

test('unparsed lens output is notified as a warning', () => {
  const sarif = toSarif(merged([
    { lens: 'ux', findings: [], unparsed: ['Here is my summary:'] }
  ]));
  const note = sarif.runs[0].invocations[0].toolExecutionNotifications
    .find(n => n.descriptor.id === 'crosscheck/unparsedOutput');
  assert.equal(note.level, 'warning');
  assert.match(note.message.text, /Here is my summary:/);
});

test('refuted findings are disclosed as notifications, not omitted silently', () => {
  const sarif = toSarif(merged([{ lens: 'check', findings: [] }]), {
    refuted: [{
      file: 'lib/a.js', line: 9, issue: 'false positive', lenses: ['check']
    }]
  });
  const note = sarif.runs[0].invocations[0].toolExecutionNotifications
    .find(n => n.descriptor.id === 'crosscheck/refuted');
  assert.match(note.message.text, /lib\/a\.js:9/);
  assert.match(note.message.text, /refuted/);
});

test('serializes to parseable JSON with a trailing newline', () => {
  const json = toSarifJson(merged([
    { lens: 'check', findings: [at('lib/a.js', 1, 'blocker', 'x')] }
  ]));
  assert.ok(json.endsWith('\n'));
  assert.equal(JSON.parse(json).version, '2.1.0');
});

// Windows. A SARIF artifactLocation is a URI reference, so a backslash path is
// not merely ugly — GitHub code scanning will not map it back to a file.
test('artifact locations are URI paths even when the finding used backslashes', () => {
  const sarif = toSarif({
    findings: [{
      file: 'src\\lib\\a.js', line: 4, severity: 'BLOCK', issue: 'i', fix: null,
      lenses: ['check'], consensus: false, consensusScore: 0, occurrences: 1,
      lines: [4], key: 'k'
    }],
    incomplete: [], unparsed: []
  });
  assert.equal(
    sarif.runs[0].results[0].locations[0].physicalLocation
      .artifactLocation.uri,
    'src/lib/a.js');
});
