/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Resolve what to review from a diff.
//
// Auditing whole paths makes cost scale with repository size rather than change
// size, and re-reviews code nobody touched. A review is of a change, so the
// target is a diff — parsed here into files and the line ranges that moved.
//
// Pure: the caller runs git and passes the text in. That keeps this testable
// against recorded diffs and keeps git invocation in one place.

// `@@ -old,count +new,count @@` — the new-side numbers are the ones that exist in
// the working tree, so those are what a lens can cite.
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const RENAME_TO = /^rename to (.+)$/;

// A deleted file has no new-side path; nothing can be reviewed in it.
const DEV_NULL = '/dev/null';

export function parseDiff(diffText) {
  const byFile = new Map();
  let current = null;
  for (const rawLine of String(diffText ?? '').split('\n')) {
    const renamed = RENAME_TO.exec(rawLine);
    if (renamed) {
      current = renamed[1].trim();
      if (!byFile.has(current)) {
        byFile.set(current, []);
      }
      continue;
    }
    const header = FILE_HEADER.exec(rawLine);
    if (header) {
      const path = header[1].trim();
      current = path === DEV_NULL ? null : path;
      if (current && !byFile.has(current)) {
        byFile.set(current, []);
      }
      continue;
    }
    const hunk = HUNK.exec(rawLine);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] == null ? 1 : Number(hunk[2]);
      // A hunk with count 0 is a pure deletion at that point: there are no new
      // lines to review, so it contributes no range.
      if (count > 0) {
        byFile.get(current).push([start, start + count - 1]);
      }
    }
  }
  return [...byFile.entries()].map(([file, ranges]) => ({
    file,
    ranges: mergeRanges(ranges)
  }));
}

// Adjacent or overlapping hunks read better as one range, and a lens does not
// care that git split them.
export function mergeRanges(ranges, gap = 1) {
  const sorted = [...(ranges ?? [])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1] + gap) {
      last[1] = Math.max(last[1], end);
      continue;
    }
    out.push([start, end]);
  }
  return out;
}

// Widen each range by `context` lines so a lens can see what surrounds a change.
// A defect introduced by a diff is frequently visible only against the code the
// diff did not touch.
export function withContext(ranges, context = 20, maxLine = Infinity) {
  return mergeRanges((ranges ?? []).map(([start, end]) =>
    [Math.max(1, start - context), Math.min(maxLine, end + context)]));
}

export function changedFiles(diffText) {
  return parseDiff(diffText).map(entry => entry.file);
}

// Files with no reviewable new-side content — deletions — are excluded by
// parseDiff, so anything returned here exists and has lines a lens can cite.
export function targetFromDiff(diffText, { filter = null } = {}) {
  const entries = parseDiff(diffText)
    .filter(entry => entry.ranges.length > 0)
    .filter(entry => (filter ? filter(entry.file) : true));
  return {
    files: entries.map(e => e.file),
    rangesByFile: Object.fromEntries(entries.map(e => [e.file, e.ranges]))
  };
}

export function formatRanges(ranges) {
  return (ranges ?? [])
    .map(([start, end]) => start === end ? `${start}` : `${start}-${end}`)
    .join(', ');
}

// The git command for each targeting mode. Returned rather than executed so the
// caller owns process spawning and this stays pure.
export function diffCommand({ diff, staged, since } = {}) {
  // --unified=0 keeps hunk headers tight to the changed lines; context is added
  // deliberately by withContext rather than inherited from git's default.
  const base = ['diff', '--unified=0', '--no-color', '--no-ext-diff'];
  if (staged) {
    return [...base, '--cached'];
  }
  if (since) {
    return [...base, `${since}...HEAD`];
  }
  if (typeof diff === 'string' && diff !== '' && diff !== 'true') {
    return [...base, `${diff}...HEAD`];
  }
  // Bare --diff: everything not yet committed, staged or not.
  return [...base, 'HEAD'];
}
