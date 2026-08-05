/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isNoFindings,
  parseFindingLine,
  parseLensOutput,
  parseReports
} from '../lib/parse.mjs';

test('parses the finding contract', () => {
  const f = parseFindingLine(
    'lib/a.js:41 — BLOCK — expires stored as a number — store a Date');
  assert.deepEqual(f, {
    file: 'lib/a.js', line: 41, severity: 'BLOCK',
    issue: 'expires stored as a number', fix: 'store a Date'
  });
});

test('accepts en dash and double hyphen as separators', () => {
  for (const sep of ['—', '–', '--']) {
    const f = parseFindingLine(`lib/a.js:7 ${sep} FIX ${sep} issue ${sep} fix`);
    assert.equal(f?.severity, 'FIX', `separator ${sep}`);
    assert.equal(f?.issue, 'issue');
  }
});

test('strips list bullets and numbering that models add', () => {
  for (const prefix of ['- ', '* ', '1. ', '2) ']) {
    const f = parseFindingLine(`${prefix}lib/a.js:9 — FIX — issue — fix`);
    assert.equal(f?.line, 9, `prefix ${prefix}`);
  }
});

test('keeps a separator that appears inside the issue text', () => {
  const f = parseFindingLine(
    'lib/a.js:5 — BLOCK — the read path — which lags — returns stale rows — guard it');
  assert.equal(f.issue, 'the read path — which lags — returns stale rows');
  assert.equal(f.fix, 'guard it');
});

test('tolerates a column in the location', () => {
  assert.equal(parseFindingLine('lib/a.js:41:7 — FIX — issue — fix')?.line, 41);
});

test('a finding with no fix still parses, with fix null', () => {
  const f = parseFindingLine('lib/a.js:41 — CONSIDER — naming is vague');
  assert.equal(f.fix, null);
  assert.equal(f.issue, 'naming is vague');
});

test('rejects lines that carry no location or no issue', () => {
  for (const line of [
    'BLOCK — something is wrong — fix it',
    'Here is my summary of the review.',
    'lib/a.js — BLOCK — no line number — fix',
    'lib/a.js:41 — BLOCK',
    ''
  ]) {
    assert.equal(parseFindingLine(line), null, JSON.stringify(line));
  }
});

test('NO FINDINGS is recognized, and is not an error', () => {
  assert.equal(isNoFindings('NO FINDINGS'), true);
  assert.equal(isNoFindings('  no findings  '), true);
  assert.equal(isNoFindings('no findings were relevant'), false);
  const r = parseLensOutput('NO FINDINGS');
  assert.deepEqual(r, { findings: [], unparsed: [], noFindings: true });
});

test('unparsed lines are reported, never silently dropped', () => {
  const r = parseLensOutput([
    'Sure! Here is what I found:',
    'lib/a.js:41 — BLOCK — real finding — fix it',
    'Overall the code is good.'
  ].join('\n'));
  assert.equal(r.findings.length, 1);
  assert.deepEqual(r.unparsed,
    ['Sure! Here is what I found:', 'Overall the code is good.']);
});

test('a lens that did not complete is distinct from one that found nothing', () => {
  const parsed = parseReports([
    { lens: 'check', output: 'NO FINDINGS' },
    { lens: 'ux', output: null },
    null
  ]);
  assert.deepEqual(parsed[0].findings, [], 'ran, found nothing');
  assert.equal(parsed[1].findings, null, 'did not complete');
  assert.equal(parsed[2].lens, '<unknown>');
  assert.equal(parsed[2].findings, null);
});
