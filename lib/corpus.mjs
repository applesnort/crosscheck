/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Adapter for externally authored defect corpora, and file-level scoring.
//
// The built-in fixture scores by line span, which works when you planted the
// defects and know where they are. External corpora label a whole test case
// instead, and — the reason they matter — they label cases where the code looks
// vulnerable and is not. Those are the false-positive opportunities a
// self-authored fixture cannot honestly provide, because the same hand wrote the
// decoys, the answer key, and the lens prompts.
//
// Nothing here vendors a corpus. It reads one that has been fetched locally.

// OWASP Benchmark categories mapped to the CWE they carry and the vocabulary a
// finding would use. A finding counts as matching a case only if it cites the
// CWE number or this vocabulary — a lens reporting some unrelated real issue in
// a safe case is neither credited nor penalised.
export const OWASP_CATEGORIES = {
  sqli: { cwe: 89, terms: ['sql injection', 'sqli', 'sql statement', 'prepared statement', 'parameteriz', 'query concatenat'] },
  weakrand: { cwe: 330, terms: ['weak random', 'insecure random', 'predictable', 'java.util.random', 'securerandom', 'insufficient entropy'] },
  xss: { cwe: 79, terms: ['cross-site scripting', 'xss', 'html escap', 'output encod', 'unescaped'] },
  pathtraver: { cwe: 22, terms: ['path traversal', 'directory traversal', 'file path', 'canonicaliz', '../'] },
  cmdi: { cwe: 78, terms: ['command injection', 'cmdi', 'os command', 'runtime.exec', 'processbuilder', 'shell'] },
  crypto: { cwe: 327, terms: ['weak cipher', 'broken cipher', 'insecure crypto', 'des', 'ecb', 'weak encryption', 'broken crypto'] },
  hash: { cwe: 328, terms: ['weak hash', 'broken hash', 'md5', 'sha1', 'sha-1', 'insecure hash'] },
  trustbound: { cwe: 501, terms: ['trust boundary', 'session attribute', 'untrusted data stored', 'trust violation'] },
  securecookie: { cwe: 614, terms: ['secure flag', 'secure cookie', 'cookie without secure', 'httponly', 'insecure cookie'] },
  ldapi: { cwe: 90, terms: ['ldap injection', 'ldapi', 'ldap filter', 'ldap query'] },
  xpathi: { cwe: 643, terms: ['xpath injection', 'xpathi', 'xpath expression', 'xpath query'] }
};

// `# comment` header, then: testname,category,realVulnerability,cwe
export function parseExpectedResults(csv) {
  const cases = [];
  for (const line of String(csv ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const [name, category, real, cwe] = trimmed.split(',').map(f => f.trim());
    if (!name || !category || !real) {
      continue;
    }
    if (real !== 'true' && real !== 'false') {
      throw new Error(
        `unexpected label "${real}" for ${name}; expected true or false`);
    }
    cases.push({
      name,
      category,
      vulnerable: real === 'true',
      cwe: Number(cwe)
    });
  }
  if (cases.length === 0) {
    throw new Error('no cases parsed — is this the expectedresults CSV?');
  }
  return cases;
}

// The pre-registered sampling rule: for each category, the first N `true` and
// first N `false` cases by ascending test number. Mechanical and reproducible —
// no hand-picking, and re-running it on the same corpus yields the same sample.
export function sampleCases(cases, perLabel = 3) {
  const byCategory = new Map();
  for (const c of cases ?? []) {
    if (!byCategory.has(c.category)) {
      byCategory.set(c.category, []);
    }
    byCategory.get(c.category).push(c);
  }
  const sample = [];
  const shortfalls = [];
  for (const category of [...byCategory.keys()].sort()) {
    const group = [...byCategory.get(category)]
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const vulnerable of [true, false]) {
      const matching = group.filter(c => c.vulnerable === vulnerable);
      const taken = matching.slice(0, perLabel);
      sample.push(...taken);
      if (taken.length < perLabel) {
        shortfalls.push({
          category, vulnerable, wanted: perLabel, available: taken.length
        });
      }
    }
  }
  return { sample, shortfalls };
}

// Does this finding claim the vulnerability the case is about? Citing the CWE
// number is decisive; otherwise the category vocabulary has to appear.
export function findingMatchesCase(finding, testCase) {
  const meta = OWASP_CATEGORIES[testCase.category];
  const text = `${finding.issue ?? ''} ${finding.fix ?? ''}`.toLowerCase();
  const cwe = meta?.cwe ?? testCase.cwe;
  if (cwe && new RegExp(`cwe[- ]?0*${cwe}\\b`, 'i').test(text)) {
    return true;
  }
  return (meta?.terms ?? []).some(term => text.includes(term));
}

// findings must already be merged (so `lenses` and `consensus` are populated).
// Returns per-case classification plus the aggregate the claim turns on.
export function scoreCases(results, options = {}) {
  const { onlyMatching = true } = options;
  const perCase = [];
  let truePositives = 0;
  let falsePositives = 0;
  let missed = 0;
  let declined = 0;
  let unrelated = 0;
  const matchedFindings = [];

  for (const { testCase, findings } of results ?? []) {
    const matching = (findings ?? []).filter(f =>
      findingMatchesCase(f, testCase));
    const others = (findings ?? []).length - matching.length;
    unrelated += others;
    matchedFindings.push(...matching.map(f => ({ finding: f, testCase })));

    let outcome;
    if (testCase.vulnerable) {
      outcome = matching.length > 0 ? 'true-positive' : 'missed';
      if (matching.length > 0) {
        truePositives += 1;
      } else {
        missed += 1;
      }
    } else {
      outcome = matching.length > 0 ? 'false-positive' : 'declined';
      if (matching.length > 0) {
        falsePositives += 1;
      } else {
        declined += 1;
      }
    }
    perCase.push({
      name: testCase.name,
      category: testCase.category,
      vulnerable: testCase.vulnerable,
      outcome,
      matched: matching.length,
      unrelated: others,
      lenses: [...new Set(matching.flatMap(f => f.lenses ?? []))]
    });
  }

  // The comparison the whole ranking rests on. A matched finding in a
  // `false`-labeled case is wrong; in a `true`-labeled case it is right. So
  // precision can be computed separately for consensus and solo findings.
  const pool = onlyMatching ? matchedFindings : matchedFindings;
  const consensus = pool.filter(m => m.finding.consensus === true);
  const solo = pool.filter(m => m.finding.consensus !== true);

  return {
    cases: perCase.length,
    truePositives,
    falsePositives,
    missed,
    declined,
    unrelatedFindings: unrelated,
    recall: (truePositives + missed) === 0
      ? null : round(truePositives / (truePositives + missed)),
    specificity: (falsePositives + declined) === 0
      ? null : round(declined / (falsePositives + declined)),
    consensusPrecision: precisionOf(consensus),
    soloPrecision: precisionOf(solo),
    consensusCount: consensus.length,
    soloCount: solo.length,
    perCase
  };
}

function precisionOf(matched) {
  if (matched.length === 0) {
    return null;
  }
  const correct = matched.filter(m => m.testCase.vulnerable).length;
  return round(correct / matched.length);
}

function round(n) {
  return Number(n.toFixed(4));
}

export function formatCaseScore(result) {
  const pct = v => v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
  const lines = [
    `cases scored:        ${result.cases}`,
    `vulnerable found:    ${result.truePositives}  (recall ${pct(result.recall)})`,
    `vulnerable missed:   ${result.missed}`,
    `safe declined:       ${result.declined}  (specificity ${pct(result.specificity)})`,
    `FALSE POSITIVES:     ${result.falsePositives}`,
    `unrelated findings:  ${result.unrelatedFindings}  (neither credited nor penalised)`,
    '',
    'consensus vs solo precision — the claim under test:',
    `  consensus (${result.consensusCount}): ${pct(result.consensusPrecision)}`,
    `  solo      (${result.soloCount}): ${pct(result.soloPrecision)}`,
    ''
  ];
  if (result.falsePositives < 3) {
    lines.push(
      'Fewer than 3 false positives — per the pre-registered criteria this is',
      'INCONCLUSIVE regardless of which precision is higher.', '');
  } else if (result.consensusPrecision != null && result.soloPrecision != null) {
    const delta = result.consensusPrecision - result.soloPrecision;
    lines.push(
      `consensus advantage: ${(delta * 100).toFixed(1)} points`,
      delta >= 0.1 ? 'Criteria met: claim SUPPORTED.'
        : delta <= 0 ? 'Criteria met: claim REFUTED.'
          : 'Between thresholds: INCONCLUSIVE.', '');
  }
  const byCategory = new Map();
  for (const c of result.perCase) {
    if (!byCategory.has(c.category)) {
      byCategory.set(c.category, { tp: 0, fp: 0, missed: 0, declined: 0 });
    }
    const bucket = byCategory.get(c.category);
    if (c.outcome === 'true-positive') bucket.tp += 1;
    else if (c.outcome === 'false-positive') bucket.fp += 1;
    else if (c.outcome === 'missed') bucket.missed += 1;
    else bucket.declined += 1;
  }
  lines.push('per category (tp / missed / fp / declined):');
  for (const [category, b] of [...byCategory.entries()].sort()) {
    lines.push(`  ${category.padEnd(14)} ${b.tp} / ${b.missed} / ${b.fp} / ${b.declined}`);
  }
  return lines.join('\n');
}
