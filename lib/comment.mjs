/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Build a pull-request comment.
//
// Deliberately a summary, not per-line review comments. SARIF uploaded to code
// scanning already annotates the exact lines in the Files-changed view, and does
// it better than a bot posting threads. What that view cannot show is the shape of
// the run: which lenses were skipped, which died, what the baseline suppressed,
// what verification refuted. That is what this comment carries.
//
// Every comment embeds a marker so a later run can edit the previous one instead
// of stacking. A PR with eleven bot comments gets muted, and a muted reviewer
// finds nothing.

export const COMMENT_MARKER = '<!-- crosscheck:report -->';

const LEVEL_LABEL = { BLOCK: '🔴 BLOCK', FIX: '🟡 FIX', CONSIDER: '⚪ CONSIDER' };

function severitySection(findings, severity, { limit }) {
  const group = findings.filter(f => f.severity === severity);
  if (group.length === 0) {
    return [];
  }
  const lines = [`### ${LEVEL_LABEL[severity]} (${group.length})`, ''];
  for (const f of group.slice(0, limit)) {
    const who = f.consensus
      ? `**${f.lenses.join(' + ')}** agreed`
      : `${f.lenses.join(', ')}`;
    const collapsed = f.occurrences > f.lenses.length
      ? ` · ${f.occurrences} reports across lines ${f.lines.join(', ')}`
      : '';
    lines.push(
      `- \`${f.file}:${f.line}\` — ${f.issue}` +
      (f.fix ? `\n  **Fix:** ${f.fix}` : '') +
      `\n  <sub>${who}${collapsed}</sub>`);
  }
  if (group.length > limit) {
    // Named, not hidden: a truncated list that does not say so reads as the
    // whole list.
    lines.push('', `_…and ${group.length - limit} more ${severity} finding(s) ` +
      'not shown here. The full set is in the SARIF output and the run log._');
  }
  lines.push('');
  return lines;
}

// merged: the object from mergeFindings, optionally with the run's disclosures.
export function buildComment({
  merged,
  refuted = [],
  suppressed = [],
  dropped = [],
  skipped = [],
  target = null,
  sarifPath = null,
  limitPerSeverity = 10
} = {}) {
  const findings = merged?.findings ?? [];
  const incomplete = merged?.incomplete ?? [];
  const counts = {
    BLOCK: findings.filter(f => f.severity === 'BLOCK').length,
    FIX: findings.filter(f => f.severity === 'FIX').length,
    CONSIDER: findings.filter(f => f.severity === 'CONSIDER').length
  };

  const out = [COMMENT_MARKER, '', '## crosscheck'];

  if (target) {
    out.push('', `Reviewed ${target}.`);
  }

  if (findings.length === 0) {
    out.push('', 'No findings.');
  } else {
    out.push('',
      `**${counts.BLOCK} block · ${counts.FIX} fix · ${counts.CONSIDER} consider**` +
      (findings.some(f => f.consensus)
        ? ` · ${findings.filter(f => f.consensus).length} agreed by more than one lens`
        : ''),
      '');
    for (const severity of ['BLOCK', 'FIX', 'CONSIDER']) {
      out.push(...severitySection(findings, severity, { limit: limitPerSeverity }));
    }
  }

  // The disclosures. Each one is a hole in the coverage, and a report that omits
  // them reads as completeness that was never there. Zeroes are stated too.
  const notes = [];
  notes.push(`Refuted in verification: ${refuted.length}`);
  if (incomplete.length) {
    notes.push(`**Did not complete: ${incomplete.join(', ')}** — their coverage ` +
      'is missing from this report');
  }
  if (dropped.length) {
    notes.push(`**Budget reached** — not run: ${dropped.map(d => d.lens ?? d).join(', ')}`);
  }
  if (suppressed.length) {
    notes.push(`Suppressed by baseline: ${suppressed.length}`);
  }
  if (skipped.length) {
    // Two different reasons — nothing in scope matched, or you excluded it — and
    // calling an explicit exclusion "irrelevant" misstates the run.
    const irrelevant = skipped.filter(s => !/--only|--skip/.test(s.reason ?? ''));
    const excluded = skipped.filter(s => /--only|--skip/.test(s.reason ?? ''));
    if (irrelevant.length) {
      notes.push('Not applicable to these files: ' +
        irrelevant.map(s => s.lens ?? s).join(', '));
    }
    if (excluded.length) {
      notes.push('Excluded by request: ' +
        excluded.map(s => s.lens ?? s).join(', '));
    }
  }
  out.push('<details><summary>Run details</summary>', '');
  for (const note of notes) {
    out.push(`- ${note}`);
  }
  if (sarifPath) {
    out.push('', `SARIF written to \`${sarifPath}\` — upload it to code scanning ` +
      'for per-line annotations in the Files changed view.');
  }
  out.push('', '</details>');

  return out.join('\n') + '\n';
}

// True when a comment body was written by crosscheck, so a run can edit its own
// previous comment rather than adding another.
export function isOwnComment(body) {
  return String(body ?? '').includes(COMMENT_MARKER);
}

// Given the comments on a PR, the id of ours to update, or null to create one.
export function findOwnComment(comments) {
  const mine = (comments ?? []).filter(c => isOwnComment(c.body));
  return mine.length ? mine[mine.length - 1].id ?? null : null;
}
