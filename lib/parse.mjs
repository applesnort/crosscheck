/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Parse a lens's raw text output into structured findings.
//
// Lenses emit one finding per line against a fixed contract:
//   file:line — SEVERITY — issue — fix
// and return exactly `NO FINDINGS` when nothing in scope is relevant.
//
// Parsing is deliberately lenient about the separator (em dash, en dash, or a
// double hyphen) and strict about everything else: a line that does not carry a
// location and a severity is not a finding, and is reported as unparsed rather
// than dropped. Silently discarding a lens's output would turn a broken lens
// into a clean one.

export const NO_FINDINGS = 'NO FINDINGS';

// A lens states what it examined, so that declining to report is a claim a
// reader can check rather than an absence they must trust. Captured separately
// from findings: coverage is evidence about the search, not about the code.
const COVERAGE = /^\s*COVERAGE:\s*(\S+)\s*(?:[—–-]\s*(.+))?$/;

const SEPARATOR = /\s+(?:—|–|--)\s+/;
const LOCATION = /^(.+?):(\d+)(?::\d+)?$/;

// A lens that produced nothing usable still has to be distinguishable from a
// lens that looked and found nothing.
export function isNoFindings(text) {
  return String(text ?? '').trim().toUpperCase() === NO_FINDINGS;
}

function stripBullet(line) {
  return line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
}

export function parseFindingLine(line) {
  const cleaned = stripBullet(String(line ?? ''));
  if (!cleaned) {
    return null;
  }
  const parts = cleaned.split(SEPARATOR).map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const location = LOCATION.exec(parts[0]);
  if (!location) {
    return null;
  }
  const [, file, line_] = location;
  const severity = parts[1];
  // The issue text may itself contain a separator, so the fix is the last
  // segment and the issue is everything between severity and fix.
  const fix = parts.length >= 4 ? parts[parts.length - 1] : null;
  const issueParts = parts.length >= 4
    ? parts.slice(2, parts.length - 1)
    : parts.slice(2);
  const issue = issueParts.join(' — ');
  if (!issue) {
    return null;
  }
  return { file, line: Number(line_), severity, issue, fix };
}

// Returns { findings, unparsed, noFindings } for one lens's raw output.
// `report` of null/undefined means the lens did not complete at all — that is
// the caller's concern (see mergeFindings), not a parse result.
export function parseLensOutput(text) {
  const raw = String(text ?? '');
  if (isNoFindings(raw)) {
    return { findings: [], unparsed: [], coverage: [], noFindings: true };
  }
  const findings = [];
  const unparsed = [];
  const coverage = [];
  // Coverage lines precede the abstention, so an output that declines to report
  // no longer arrives as a single line. The flag has to be tracked through the
  // loop rather than decided before it, or a lens that stated its coverage
  // would read as a lens that returned nothing at all.
  let declined = false;
  for (const line of raw.split('\n')) {
    const cov = COVERAGE.exec(line);
    if (cov && cov[2]?.trim()) {
      coverage.push({ id: cov[1], examined: cov[2].trim() });
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    if (isNoFindings(line)) {
      declined = true;
      continue;
    }
    const parsed = parseFindingLine(line);
    if (parsed) {
      findings.push(parsed);
    } else {
      unparsed.push(line.trim());
    }
  }
  // Control findings are evidence about the runner. They leave `findings`
  // entirely, so a canary can never be reported as a defect in the user's code.
  const { real, controls } = splitControlFindings(findings);
  return {
    findings: real, unparsed, coverage, controls,
    noFindings: declined && real.length === 0
  };
}

// reports: [{lens, output}] where output is the lens's raw text, or null if the
// lens did not complete. Produces the shape mergeFindings consumes.
// Findings about a positive control are evidence about the runner, not about
// the repository, and must never reach a report as though they were defects in
// the user's code.
export function splitControlFindings(findings, prefix = 'crosscheck-control://') {
  const real = [];
  const controls = [];
  for (const f of findings ?? []) {
    const file = String(f?.file ?? '');
    if (!file.startsWith(prefix)) {
      real.push(f);
      continue;
    }
    const id = file.slice(prefix.length).replace(/\.[a-z]+$/i, '');
    if (!controls.includes(id)) {
      controls.push(id);
    }
  }
  return { real, controls };
}

export function parseReports(reports) {
  return (reports ?? []).map(r => {
    if (!r || r.output == null) {
      return {
        lens: r?.lens ?? '<unknown>', findings: null, unparsed: [],
        coverage: [], controls: []
      };
    }
    const { findings, unparsed, coverage, controls } = parseLensOutput(r.output);
    return { lens: r.lens, findings, unparsed, coverage, controls };
  });
}
