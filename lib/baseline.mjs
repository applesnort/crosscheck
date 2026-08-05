/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Baseline support: the difference between a panel a team keeps running and one
// they run once.
//
// The first run against an existing codebase returns hundreds of findings, and
// the report gets closed. A baseline records what was already there, so later
// runs report what the change introduced. Suppressed counts are always
// returned — a baseline that hides its own size is a way to make a codebase
// look clean by declaring its problems normal.

import { fingerprint } from './sarif.mjs';

export const BASELINE_VERSION = 1;

export function toBaseline(findings, options = {}) {
  const { note = null } = options;
  const entries = (findings ?? []).map(f => ({
    fingerprint: fingerprint(f),
    file: f.file,
    line: f.line,
    severity: f.severity,
    // Stored for human review of the baseline file, not used for matching.
    issue: f.issue,
    lenses: f.lenses
  }));
  entries.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line ||
    a.fingerprint.localeCompare(b.fingerprint));
  return {
    version: BASELINE_VERSION,
    note,
    count: entries.length,
    findings: entries
  };
}

export function baselineFingerprints(baseline) {
  if (!baseline) {
    return new Set();
  }
  if (baseline.version !== BASELINE_VERSION) {
    throw new Error(
      `Unsupported baseline version ${baseline.version}; expected ` +
      `${BASELINE_VERSION}. Regenerate the baseline rather than editing it.`);
  }
  return new Set((baseline.findings ?? []).map(f => f.fingerprint));
}

// Returns { findings, suppressed } — findings not present in the baseline, and
// the ones that were. Both are returned so the caller can report the second
// number instead of quietly dropping it.
export function filterAgainstBaseline(findings, baseline) {
  const known = baselineFingerprints(baseline);
  if (known.size === 0) {
    return { findings: findings ?? [], suppressed: [] };
  }
  const fresh = [];
  const suppressed = [];
  for (const finding of findings ?? []) {
    if (known.has(fingerprint(finding))) {
      suppressed.push(finding);
    } else {
      fresh.push(finding);
    }
  }
  return { findings: fresh, suppressed };
}

// Entries in the baseline that no longer appear in a run. Worth surfacing:
// either they were fixed and the baseline should shrink, or the lens that found
// them stopped running and coverage silently dropped.
export function staleBaselineEntries(baseline, findings) {
  const current = new Set((findings ?? []).map(fingerprint));
  return (baseline?.findings ?? [])
    .filter(entry => !current.has(entry.fingerprint));
}
