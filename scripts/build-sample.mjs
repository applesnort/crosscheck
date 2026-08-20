#!/usr/bin/env node
/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Apply the pre-registered sampling rule to the fetched corpus and write the
// manifest. Committed before any run, so the sample cannot be redrawn after
// seeing results.
//
// Rule (fixtures/calibration/PREREGISTERED.md): for each category, the first 3
// `true` and first 3 `false` cases by ascending test number.
//
// Usage: node scripts/build-sample.mjs [perLabel]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExpectedResults, sampleCases } from '../lib/corpus.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORPUS = join(ROOT, 'corpus/owasp-benchmark');
const LABELS = join(CORPUS, 'expectedresults-1.2.csv');
const OUT = join(ROOT, 'fixtures/corpus-sample.json');
const PER_LABEL = Number(process.argv[2] ?? 3);

if (!existsSync(LABELS)) {
  process.stderr.write(
    `Corpus not found at ${LABELS}\nRun: bash scripts/fetch-corpus.sh\n`);
  process.exit(2);
}

const cases = parseExpectedResults(readFileSync(LABELS, 'utf8'));
const { sample, shortfalls } = sampleCases(cases, PER_LABEL);

const manifest = {
  corpus: 'OWASP Benchmark v1.2',
  source: 'https://github.com/OWASP-Benchmark/BenchmarkJava',
  note: 'Not vendored. Fetch with scripts/fetch-corpus.sh. Sample drawn by the ' +
    'pre-registered rule: first N true and N false per category, ascending by ' +
    'test number.',
  perLabel: PER_LABEL,
  totalCasesAvailable: cases.length,
  vulnerableAvailable: cases.filter(c => c.vulnerable).length,
  safeAvailable: cases.filter(c => !c.vulnerable).length,
  sampled: sample.length,
  sampledVulnerable: sample.filter(c => c.vulnerable).length,
  sampledSafe: sample.filter(c => !c.vulnerable).length,
  shortfalls,
  cases: sample.map(c => ({
    name: c.name,
    category: c.category,
    cwe: c.cwe,
    vulnerable: c.vulnerable,
    path: `src/main/java/org/owasp/benchmark/testcode/${c.name}.java`
  }))
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

process.stdout.write(
  `wrote ${OUT}\n` +
  `  available:  ${manifest.totalCasesAvailable} cases ` +
  `(${manifest.vulnerableAvailable} vulnerable, ${manifest.safeAvailable} safe)\n` +
  `  sampled:    ${manifest.sampled} ` +
  `(${manifest.sampledVulnerable} vulnerable, ${manifest.sampledSafe} safe)\n` +
  (shortfalls.length
    ? `  shortfalls: ${shortfalls.map(s =>
      `${s.category}/${s.vulnerable ? 'true' : 'false'} ${s.available}/${s.wanted}`)
      .join(', ')}\n`
    : '  shortfalls: none\n'));
