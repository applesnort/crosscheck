/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Score a panel run against planted ground truth.
//
// Without this, a persona panel is unfalsifiable: you cannot tell whether it
// works, whether a new lens helped, or whether a prompt edit made it worse.
// Given a fixture whose defects are known (fixtures/calibration/expected.json)
// and the panel's own findings, this measures recall per lens, the false
// positive rate, and — the claim worth checking — whether consensus findings are
// actually more likely to be real than single-lens ones.
//
// This module scores an existing run. It does not run a panel and never
// fabricates one: if you have no panel output, you have no score.

import { normalizeSeverity } from './merge.mjs';

// A lens may reasonably anchor a finding on the offending statement, the
// enclosing function signature, or a line between them.
export function matchesDefect(finding, defect) {
  if (finding.file !== defect.file) {
    return false;
  }
  const [lo, hi] = defect.span ?? [defect.line, defect.line];
  return finding.line >= lo && finding.line <= hi;
}

export function findDefect(finding, defects) {
  return (defects ?? []).find(d => matchesDefect(finding, d)) ?? null;
}

// A lens gets credit for a defect if it is the expected owner or listed in
// alsoAcceptedBy. Reporting a real defect outside your remit is not scored as a
// false positive — it is real — but it does not count toward the owner's recall.
export function lensIsCredited(lens, defect) {
  return defect.expectedBy === lens ||
    (defect.alsoAcceptedBy ?? []).includes(lens);
}

// findings: merged findings ([{file, line, severity, lenses, consensus,
//   consensusScore, issue}]). expected: the parsed expected.json.
export function score(findings, expected) {
  const defects = expected?.defects ?? [];
  const list = findings ?? [];

  const matchedByDefect = new Map();
  const truePositives = [];
  const falsePositives = [];

  for (const finding of list) {
    const defect = findDefect(finding, defects);
    if (!defect) {
      falsePositives.push(finding);
      continue;
    }
    truePositives.push({ finding, defect });
    if (!matchedByDefect.has(defect.id)) {
      matchedByDefect.set(defect.id, []);
    }
    matchedByDefect.get(defect.id).push(finding);
  }

  const missed = defects.filter(d => !matchedByDefect.has(d.id));

  // Per-lens recall against the defects that lens is credited for.
  const lenses = [...new Set(list.flatMap(f => f.lenses ?? []))].sort();
  const perLens = {};
  for (const lens of lenses) {
    const owned = defects.filter(d => lensIsCredited(lens, d));
    const found = owned.filter(d =>
      (matchedByDefect.get(d.id) ?? []).some(f => (f.lenses ?? []).includes(lens)));
    const reported = list.filter(f => (f.lenses ?? []).includes(lens));
    const spurious = reported.filter(f => !findDefect(f, defects));
    perLens[lens] = {
      owned: owned.length,
      found: found.length,
      recall: owned.length === 0 ? null : round(found.length / owned.length),
      reported: reported.length,
      falsePositives: spurious.length,
      precision: reported.length === 0
        ? null : round((reported.length - spurious.length) / reported.length)
    };
  }

  // Severity agreement on the defects that were found.
  const severityMismatches = truePositives
    .filter(({ finding, defect }) =>
      normalizeSeverity(finding.severity) !== normalizeSeverity(defect.severity))
    .map(({ finding, defect }) => ({
      id: defect.id,
      expected: normalizeSeverity(defect.severity),
      reported: normalizeSeverity(finding.severity)
    }));

  // The load-bearing claim: is a finding several independent lenses agreed on
  // more likely to be real? If these two precisions come out equal, consensus
  // ranking is decoration.
  const consensusFindings = list.filter(f => f.consensus === true);
  const soloFindings = list.filter(f => f.consensus !== true);

  return {
    defects: defects.length,
    found: matchedByDefect.size,
    recall: defects.length === 0
      ? null : round(matchedByDefect.size / defects.length),
    missed: missed.map(d => ({ id: d.id, expectedBy: d.expectedBy })),
    reported: list.length,
    falsePositives: falsePositives.length,
    precision: list.length === 0
      ? null : round(truePositives.length / list.length),
    severityMismatches,
    consensusPrecision: precisionOf(consensusFindings, defects),
    soloPrecision: precisionOf(soloFindings, defects),
    consensusCount: consensusFindings.length,
    soloCount: soloFindings.length,
    perLens
  };
}

function precisionOf(findings, defects) {
  if (findings.length === 0) {
    return null;
  }
  const real = findings.filter(f => findDefect(f, defects)).length;
  return round(real / findings.length);
}

function round(n) {
  return Number(n.toFixed(4));
}

export function formatScore(result) {
  const pct = v => v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`;
  const lines = [
    `defects planted:   ${result.defects}`,
    `defects found:     ${result.found}  (recall ${pct(result.recall)})`,
    `findings reported: ${result.reported}  (precision ${pct(result.precision)})`,
    `false positives:   ${result.falsePositives}`,
    ''
  ];
  if (result.missed.length) {
    lines.push('missed:');
    for (const m of result.missed) {
      lines.push(`  - ${m.id} (expected from ${m.expectedBy})`);
    }
    lines.push('');
  }
  if (result.severityMismatches.length) {
    lines.push('severity mismatches:');
    for (const s of result.severityMismatches) {
      lines.push(`  - ${s.id}: expected ${s.expected}, reported ${s.reported}`);
    }
    lines.push('');
  }
  lines.push(
    'consensus vs solo precision — if these are equal, consensus ranking is',
    'decoration and should be dropped or reweighted:',
    `  consensus (${result.consensusCount}): ${pct(result.consensusPrecision)}`,
    `  solo      (${result.soloCount}): ${pct(result.soloPrecision)}`,
    '',
    'per lens:');
  for (const [lens, s] of Object.entries(result.perLens)) {
    lines.push(
      `  ${lens.padEnd(16)} recall ${pct(s.recall).padStart(6)} ` +
      `(${s.found}/${s.owned})   precision ${pct(s.precision).padStart(6)} ` +
      `(${s.falsePositives} fp of ${s.reported})`);
  }
  return lines.join('\n');
}
