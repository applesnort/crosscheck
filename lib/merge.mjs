/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Merge per-lens findings into one deduped, ranked set.
//
// This is the whole point of the panel: lenses run blind to each other, so two
// of them landing on the same location is evidence neither one alone provides.
// The merge normalizes their differing severity vocabularies onto one scale,
// collapses duplicates, and scores how much independent confirmation a finding
// actually has.
//
// Pure functions only — no IO, no process exit. The CLI in bin/ does that.

export const SEVERITIES = ['CONSIDER', 'FIX', 'BLOCK'];

const TOP_TIER =
  /^(block|blocker|must[- ]fix|critical|violation|data[- ]corrupting|invisible[- ]failure|high|error)$/i;
const MIDDLE_TIER =
  /^(fix|should[- ]fix|warning|warn|medium|moderate)$/i;

export function normalizeSeverity(raw) {
  const value = String(raw ?? '').replace(/[[\]]/g, '').trim();
  if (TOP_TIER.test(value)) {
    return 'BLOCK';
  }
  if (MIDDLE_TIER.test(value)) {
    return 'FIX';
  }
  return 'CONSIDER';
}

export function higherSeverity(a, b) {
  return SEVERITIES.indexOf(a) >= SEVERITIES.indexOf(b) ? a : b;
}

// Same place, same issue in substance. Normalizing the text is what lets two
// lenses phrase one defect differently and still collapse.
export function normalizeIssue(issue) {
  return String(issue ?? '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findingKey(finding) {
  return `${finding.file}:${finding.line}|${normalizeIssue(finding.issue)}`;
}

// Independence between two lenses, in [0, 1]. 1 means they never report the
// same thing, so their agreement is maximally informative; 0 means they are
// redundant and agreement adds nothing. Derived from calibration data by
// scripts/calibrate.mjs — see lensOverlap().
export function independence(a, b, overlap) {
  if (a === b) {
    return 0;
  }
  const key = [a, b].sort().join('|');
  const measured = overlap?.[key];
  // Absent data is treated as fully independent, and the caller is expected to
  // say so rather than let an unmeasured pair look measured.
  return measured == null ? 1 : 1 - measured;
}

// "Effective independent confirmations": 1 for a single lens, and for a set,
// 1 plus the summed independence of every distinct pair. Two unrelated lenses
// agreeing scores 2.0; two redundant lenses agreeing scores 1.0. This is what
// makes consensus mean something beyond counting heads.
export function consensusScore(lenses, overlap) {
  const list = [...new Set(lenses ?? [])];
  if (list.length <= 1) {
    return 1;
  }
  let score = 1;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      score += independence(list[i], list[j], overlap);
    }
  }
  return Number(score.toFixed(4));
}

// Pairwise overlap measured from a set of per-lens findings: the Jaccard index
// of the finding keys each pair reported. Feed this back in as `overlap`.
export function lensOverlap(reports) {
  const byLens = new Map();
  for (const report of reports ?? []) {
    if (!report || report.findings == null) {
      continue;
    }
    byLens.set(report.lens,
      new Set(report.findings.map(findingKey)));
  }
  const lenses = [...byLens.keys()].sort();
  const overlap = {};
  for (let i = 0; i < lenses.length; i++) {
    for (let j = i + 1; j < lenses.length; j++) {
      const a = byLens.get(lenses[i]);
      const b = byLens.get(lenses[j]);
      const union = new Set([...a, ...b]);
      if (union.size === 0) {
        continue;
      }
      let shared = 0;
      for (const key of a) {
        if (b.has(key)) {
          shared += 1;
        }
      }
      overlap[`${lenses[i]}|${lenses[j]}`] =
        Number((shared / union.size).toFixed(4));
    }
  }
  return overlap;
}

// reports: [{lens, findings: [{file, line, severity, issue, fix}], unparsed?}]
// findings === null means that lens did not complete.
//
// options:
//   overlap  — pairwise overlap map from lensOverlap(), for consensus scoring
//   escalate — (finding, severity) => severity|null, a policy hook for callers
//              with non-negotiable categories of their own
export function mergeFindings(reports, options = {}) {
  const { overlap, escalate } = options;
  const byKey = new Map();
  const incomplete = [];
  const unparsed = [];

  for (const report of reports ?? []) {
    if (!report || report.findings == null) {
      incomplete.push(report?.lens ?? '<unknown>');
      continue;
    }
    for (const line of report.unparsed ?? []) {
      unparsed.push({ lens: report.lens, line });
    }
    for (const finding of report.findings) {
      let severity = normalizeSeverity(finding.severity);
      if (typeof escalate === 'function') {
        severity = escalate(finding, severity) ?? severity;
      }
      const key = findingKey(finding);
      const existing = byKey.get(key);
      if (existing) {
        existing.severity = higherSeverity(existing.severity, severity);
        if (!existing.lenses.includes(report.lens)) {
          existing.lenses.push(report.lens);
        }
        if (!existing.fix && finding.fix) {
          existing.fix = finding.fix;
        }
        continue;
      }
      byKey.set(key, {
        key,
        file: finding.file,
        line: finding.line,
        issue: finding.issue,
        fix: finding.fix ?? null,
        severity,
        lenses: [report.lens]
      });
    }
  }

  const findings = [...byKey.values()].map(f => ({
    ...f,
    consensus: f.lenses.length > 1,
    consensusScore: consensusScore(f.lenses, overlap)
  }));

  // Severity first, then the strength of independent confirmation, then
  // location so the order is stable across runs.
  findings.sort((a, b) =>
    SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) ||
    b.consensusScore - a.consensusScore ||
    a.file.localeCompare(b.file) ||
    a.line - b.line);

  return { findings, incomplete, unparsed };
}

// Apply refutation verdicts from a verify pass. verdicts is keyed by finding
// key: {refuted: boolean, reason?}. Refuted findings are removed from the
// report and returned separately — a dropped finding that vanishes without a
// count is indistinguishable from one that was never found.
export function applyVerdicts(findings, verdicts) {
  const kept = [];
  const refuted = [];
  for (const finding of findings ?? []) {
    const verdict = verdicts?.[finding.key];
    if (verdict?.refuted) {
      refuted.push({ ...finding, refutedReason: verdict.reason ?? null });
    } else {
      kept.push(finding);
    }
  }
  return { findings: kept, refuted };
}

export function countsBySeverity(findings) {
  const counts = { BLOCK: 0, FIX: 0, CONSIDER: 0 };
  for (const finding of findings ?? []) {
    counts[finding.severity] += 1;
  }
  return counts;
}

export function panelVerdict(counts) {
  if (counts.BLOCK > 0) {
    return 'Do not ship — blockers present';
  }
  if (counts.FIX > 0) {
    return 'Fix before merge';
  }
  return 'Ship';
}
