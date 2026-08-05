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
    return { findings: [], unparsed: [], noFindings: true };
  }
  const findings = [];
  const unparsed = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    if (isNoFindings(line)) {
      continue;
    }
    const parsed = parseFindingLine(line);
    if (parsed) {
      findings.push(parsed);
    } else {
      unparsed.push(line.trim());
    }
  }
  return { findings, unparsed, noFindings: false };
}

// reports: [{lens, output}] where output is the lens's raw text, or null if the
// lens did not complete. Produces the shape mergeFindings consumes.
export function parseReports(reports) {
  return (reports ?? []).map(r => {
    if (!r || r.output == null) {
      return { lens: r?.lens ?? '<unknown>', findings: null, unparsed: [] };
    }
    const { findings, unparsed } = parseLensOutput(r.output);
    return { lens: r.lens, findings, unparsed };
  });
}
