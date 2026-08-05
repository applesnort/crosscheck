/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Run: node --test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeFindings } from '../lib/merge.mjs';
import {
  OWASP_CATEGORIES,
  findingMatchesCase,
  formatCaseScore,
  parseExpectedResults,
  sampleCases,
  scoreCases
} from '../lib/corpus.mjs';

const CSV = [
  '# test name, category, real vulnerability, cwe, Benchmark version: 1.2',
  'BenchmarkTest00001,pathtraver,true,22',
  'BenchmarkTest00002,pathtraver,true,22',
  'BenchmarkTest00003,pathtraver,true,22',
  'BenchmarkTest00004,pathtraver,true,22',
  'BenchmarkTest00005,pathtraver,false,22',
  'BenchmarkTest00006,pathtraver,false,22',
  'BenchmarkTest00007,pathtraver,false,22',
  'BenchmarkTest00008,sqli,true,89',
  'BenchmarkTest00009,sqli,false,89',
  'BenchmarkTest00010,xpathi,true,643',
  ''
].join('\n');

test('parses the label CSV and skips the comment header', () => {
  const cases = parseExpectedResults(CSV);
  assert.equal(cases.length, 10);
  assert.deepEqual(cases[0],
    { name: 'BenchmarkTest00001', category: 'pathtraver', vulnerable: true, cwe: 22 });
  assert.equal(cases.find(c => c.name === 'BenchmarkTest00005').vulnerable, false);
});

test('an unrecognized label throws rather than defaulting to safe', () => {
  assert.throws(
    () => parseExpectedResults('# h\nBenchmarkTest00001,sqli,maybe,89'),
    /unexpected label "maybe"/);
});

test('an empty or wrong file throws rather than scoring zero cases', () => {
  assert.throws(() => parseExpectedResults(''), /no cases parsed/);
  assert.throws(() => parseExpectedResults('# just a header'), /no cases parsed/);
});

test('sampling takes the first N of each label per category, by test number', () => {
  const { sample } = sampleCases(parseExpectedResults(CSV), 3);
  const pathtraver = sample.filter(c => c.category === 'pathtraver');
  assert.deepEqual(pathtraver.filter(c => c.vulnerable).map(c => c.name),
    ['BenchmarkTest00001', 'BenchmarkTest00002', 'BenchmarkTest00003'],
    'first three true cases, ascending — 00004 is excluded');
  assert.deepEqual(pathtraver.filter(c => !c.vulnerable).map(c => c.name),
    ['BenchmarkTest00005', 'BenchmarkTest00006', 'BenchmarkTest00007']);
});

test('sampling is deterministic — the same corpus yields the same sample', () => {
  const cases = parseExpectedResults(CSV);
  const a = sampleCases(cases, 3).sample.map(c => c.name);
  const b = sampleCases([...cases].reverse(), 3).sample.map(c => c.name);
  assert.deepEqual(a, b, 'input order must not change the draw');
});

test('a category short of N cases is reported, not silently padded', () => {
  const { sample, shortfalls } = sampleCases(parseExpectedResults(CSV), 3);
  assert.equal(sample.filter(c => c.category === 'sqli').length, 2);
  const sqli = shortfalls.filter(s => s.category === 'sqli');
  assert.equal(sqli.length, 2, 'both labels short');
  assert.ok(shortfalls.some(s =>
    s.category === 'xpathi' && s.vulnerable === false && s.available === 0));
});

test('every benchmark category has a CWE and match vocabulary', () => {
  for (const [name, meta] of Object.entries(OWASP_CATEGORIES)) {
    assert.ok(Number.isInteger(meta.cwe), `${name} has a cwe`);
    assert.ok(meta.terms.length > 0, `${name} has match terms`);
  }
});

const caseFor = (category, vulnerable) => ({
  name: 'BenchmarkTest00001', category, vulnerable,
  cwe: OWASP_CATEGORIES[category].cwe
});

test('citing the CWE number matches the case', () => {
  assert.equal(findingMatchesCase(
    { issue: 'unsanitized input reaches the sink [CWE-89]' },
    caseFor('sqli', true)), true);
  assert.equal(findingMatchesCase(
    { issue: 'see cwe 089 for details' }, caseFor('sqli', true)), true);
});

test('category vocabulary matches without a CWE number', () => {
  assert.equal(findingMatchesCase(
    { issue: 'a SQL injection via string concatenation' },
    caseFor('sqli', true)), true);
  assert.equal(findingMatchesCase(
    { issue: 'weak hash: MD5 is used for a password' },
    caseFor('hash', true)), true);
});

test('an unrelated finding does not match the case', () => {
  assert.equal(findingMatchesCase(
    { issue: 'this method is too long and should be split' },
    caseFor('sqli', true)), false);
  assert.equal(findingMatchesCase(
    { issue: 'a SQL injection risk here' }, caseFor('xss', true)), false,
    'the wrong CWE must not credit the case');
});

test('the fix text is searched as well as the issue', () => {
  assert.equal(findingMatchesCase(
    { issue: 'untrusted value used directly', fix: 'use a prepared statement' },
    caseFor('sqli', true)), true);
});

// --- file-level scoring ---

const merge = reports => mergeFindings(reports).findings;
const finding = (issue, line = 30) =>
  ({ file: 'T.java', line, severity: 'BLOCK', issue, fix: 'fix it' });

test('a matched finding on a vulnerable case is a true positive', () => {
  const result = scoreCases([{
    testCase: caseFor('sqli', true),
    findings: merge([{ lens: 'security-check',
      findings: [finding('SQL injection via concatenated query [CWE-89]')] }])
  }]);
  assert.equal(result.truePositives, 1);
  assert.equal(result.falsePositives, 0);
  assert.equal(result.recall, 1);
  assert.equal(result.perCase[0].outcome, 'true-positive');
});

test('a matched finding on a SAFE case is a false positive', () => {
  const result = scoreCases([{
    testCase: caseFor('sqli', false),
    findings: merge([{ lens: 'security-check',
      findings: [finding('SQL injection via concatenated query [CWE-89]')] }])
  }]);
  assert.equal(result.falsePositives, 1);
  assert.equal(result.truePositives, 0);
  assert.equal(result.specificity, 0);
  assert.equal(result.perCase[0].outcome, 'false-positive');
});

test('declining a safe case counts toward specificity', () => {
  const result = scoreCases([
    { testCase: caseFor('sqli', false), findings: [] },
    { testCase: caseFor('xss', false), findings: [] }
  ]);
  assert.equal(result.declined, 2);
  assert.equal(result.specificity, 1);
  assert.equal(result.falsePositives, 0);
});

test('a missed vulnerable case is counted, not ignored', () => {
  const result = scoreCases([{ testCase: caseFor('cmdi', true), findings: [] }]);
  assert.equal(result.missed, 1);
  assert.equal(result.recall, 0);
  assert.equal(result.perCase[0].outcome, 'missed');
});

test('an unrelated finding in a safe case is neither credited nor penalised', () => {
  const result = scoreCases([{
    testCase: caseFor('sqli', false),
    findings: merge([{ lens: 'architect',
      findings: [finding('this servlet mixes transport and persistence concerns')] }])
  }]);
  assert.equal(result.falsePositives, 0, 'not a false positive for this case');
  assert.equal(result.truePositives, 0);
  assert.equal(result.declined, 1);
  assert.equal(result.unrelatedFindings, 1, 'but it is reported');
});

test('consensus and solo precision are computed over matched findings', () => {
  const sqlText = 'SQL injection via concatenated query [CWE-89]';
  const result = scoreCases([
    // two lenses agree on a real one
    { testCase: { ...caseFor('sqli', true), name: 'A' },
      findings: merge([
        { lens: 'security-check', findings: [finding(sqlText)] },
        { lens: 'check', findings: [finding('SQL injection through concatenated query string')] }
      ]) },
    // one lens alone is wrong about a safe one
    { testCase: { ...caseFor('sqli', false), name: 'B' },
      findings: merge([{ lens: 'security-check', findings: [finding(sqlText)] }]) }
  ]);
  assert.equal(result.consensusCount, 1);
  assert.equal(result.soloCount, 1);
  assert.equal(result.consensusPrecision, 1);
  assert.equal(result.soloPrecision, 0);
});

test('the report names the verdict per the pre-registered thresholds', () => {
  const sqlText = 'SQL injection [CWE-89]';
  const safe = n => ({
    testCase: { ...caseFor('sqli', false), name: n },
    findings: merge([{ lens: 'security-check', findings: [finding(sqlText)] }])
  });
  const thin = formatCaseScore(scoreCases([safe('A'), safe('B')]));
  assert.match(thin, /INCONCLUSIVE/, '2 false positives is below the threshold');
  const enough = formatCaseScore(scoreCases([safe('A'), safe('B'), safe('C')]));
  assert.match(enough, /FALSE POSITIVES:\s+3/);
  assert.doesNotMatch(enough, /Fewer than 3 false positives/);
});

test('per-category breakdown accounts for every case', () => {
  const result = scoreCases([
    { testCase: caseFor('sqli', true), findings: [] },
    { testCase: caseFor('xss', false), findings: [] }
  ]);
  const text = formatCaseScore(result);
  assert.match(text, /per category/);
  assert.match(text, /sqli\s+0 \/ 1 \/ 0 \/ 0/);
  assert.match(text, /xss\s+0 \/ 0 \/ 0 \/ 1/);
});

test('scoring nothing does not crash or invent a score', () => {
  const result = scoreCases([]);
  assert.equal(result.cases, 0);
  assert.equal(result.recall, null);
  assert.equal(result.consensusPrecision, null);
});

// --- case-level agreement ---

import { lensCaseOverlap, scoreCaseAgreement } from '../lib/corpus.mjs';

const SQL = 'SQL injection via concatenated query [CWE-89]';
const lensFinding = (lens, issue, line = 30) =>
  ({ lens, file: 'T.java', line, severity: 'BLOCK', issue, fix: 'fix it' });

test('two lenses on one case count as agreement regardless of line anchor', () => {
  const result = scoreCaseAgreement([{
    testCase: caseFor('sqli', true),
    findings: [
      lensFinding('security-check', SQL, 30),
      // far from the other anchor: source vs sink in the same servlet
      lensFinding('taint', 'header → concat → executeQuery, no escaping [CWE-89]', 71)
    ]
  }]);
  assert.equal(result.consensusCount, 1,
    'line distance must not split a case-level agreement');
  assert.equal(result.soloCount, 0);
  assert.equal(result.truePositives, 1);
});

test('one lens on a case is a solo detection', () => {
  const result = scoreCaseAgreement([{
    testCase: caseFor('sqli', true),
    findings: [lensFinding('security-check', SQL)]
  }]);
  assert.equal(result.soloCount, 1);
  assert.equal(result.consensusCount, 0);
});

test('the same lens twice on one case is not agreement', () => {
  const result = scoreCaseAgreement([{
    testCase: caseFor('sqli', true),
    findings: [
      lensFinding('security-check', SQL, 30),
      lensFinding('security-check', SQL, 55)
    ]
  }]);
  assert.equal(result.consensusCount, 0);
  assert.equal(result.soloCount, 1);
});

test('consensus and solo precision are measured over case detections', () => {
  const result = scoreCaseAgreement([
    { testCase: { ...caseFor('sqli', true), name: 'A' },
      findings: [lensFinding('security-check', SQL), lensFinding('taint', SQL)] },
    { testCase: { ...caseFor('sqli', false), name: 'B' },
      findings: [lensFinding('security-check', SQL)] },
    { testCase: { ...caseFor('sqli', false), name: 'C' },
      findings: [] }
  ]);
  assert.equal(result.consensusPrecision, 1, 'the agreed case was real');
  assert.equal(result.soloPrecision, 0, 'the solo case was safe');
  assert.equal(result.falsePositives, 1);
  assert.equal(result.declined, 1);
  assert.equal(result.specificity, 0.5);
});

test('unrelated findings do not create a detection', () => {
  const result = scoreCaseAgreement([{
    testCase: caseFor('sqli', false),
    findings: [
      lensFinding('architect', 'this servlet mixes transport and persistence'),
      lensFinding('check', 'the loop bound is off by one')
    ]
  }]);
  assert.equal(result.detections, 0);
  assert.equal(result.falsePositives, 0);
  assert.equal(result.declined, 1);
  assert.equal(result.unrelatedFindings, 2);
});

test('lens overlap on cases is measured, not assumed', () => {
  const results = [
    { testCase: { ...caseFor('sqli', true), name: 'A' },
      findings: [lensFinding('security-check', SQL), lensFinding('taint', SQL)] },
    { testCase: { ...caseFor('sqli', true), name: 'B' },
      findings: [lensFinding('security-check', SQL)] }
  ];
  // both flagged A; only security-check flagged B -> 1 shared of 2 union
  assert.equal(lensCaseOverlap(results)['security-check|taint'], 0.5);
});

test('scoring no cases yields nulls, not fabricated numbers', () => {
  const result = scoreCaseAgreement([]);
  assert.equal(result.cases, 0);
  assert.equal(result.consensusPrecision, null);
  assert.equal(result.soloPrecision, null);
  assert.equal(result.recall, null);
});
