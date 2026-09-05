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

// A stable identity for one finding. Used for baselines and SARIF fingerprints,
// where an exact key is what is wanted. Cross-lens matching does NOT use this —
// see sameFinding().
export function findingKey(finding) {
  return `${finding.file}:${finding.line}|${normalizeIssue(finding.issue)}`;
}

// Words that carry no signal about which defect is being described. Without
// this, two findings match on "the" and "a" and everything collapses.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'not', 'but',
  'are', 'was', 'were', 'has', 'have', 'had', 'can', 'could', 'would', 'will',
  'its', 'it', 'is', 'be', 'been', 'so', 'than', 'then', 'when', 'which',
  'who', 'what', 'how', 'any', 'all', 'each', 'every', 'same', 'other',
  'instead', 'rather', 'without', 'before', 'after', 'here', 'there', 'they',
  'them', 'their', 'you', 'your', 'use', 'used', 'using', 'fix', 'should',
  'must', 'may', 'might', 'does', 'doing', 'done', 'line', 'lines', 'file',
  'code', 'call', 'calls', 'called', 'caller', 'callers', 'function', 'later',
  'means', 'make', 'makes', 'still', 'once', 'also', 'both', 'one', 'two'
]);

export function issueTokens(issue) {
  return new Set(normalizeIssue(issue).split(' ')
    .filter(t => t.length >= 3 && !STOPWORDS.has(t)));
}

// Jaccard similarity over content words, in [0, 1]. Two lenses describing one
// defect share its nouns — the identifier, the operator, the failure — even when
// the sentences differ entirely.
export function issueSimilarity(a, b) {
  const left = issueTokens(a);
  const right = issueTokens(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }
  return Number((shared / (left.size + right.size - shared)).toFixed(4));
}

// Defaults derived from measured lens output, not from hand-written fixtures.
//
// Line tolerance: lenses anchor the same defect several lines apart — in one
// run a swallowed error was cited at 54, 56, and 57 by three lenses — so
// exact-line matching misses nearly every genuine agreement.
//
// Similarity threshold: across two runs, pairs describing the SAME defect
// scored 0.161 / 0.210 / 0.300 / 0.538, while pairs describing DIFFERENT
// defects that happened to share a line scored 0.038 / 0.050 (a timing side
// channel vs a nullish comparison on one expression; an unenforced expiry
// guard vs a split store contract on another). 0.12 sits in the gap between
// those bands. The margin is thinner above than below, so under-merging is the
// failure mode to expect first. Six pairs is a small sample — re-measure when
// the roster or the lens prompts change.
export const DEFAULT_LINE_TOLERANCE = 3;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.12;

export function sameFinding(a, b, options = {}) {
  const {
    lineTolerance = DEFAULT_LINE_TOLERANCE,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD
  } = options;
  if (a.file !== b.file) {
    return false;
  }
  if (Math.abs(a.line - b.line) > lineTolerance) {
    return false;
  }
  // Proximity alone is not enough: two unrelated defects can share a line, as
  // when one lens reports a timing side channel and another a nullish
  // comparison on the same expression. Those must stay separate.
  return issueSimilarity(a.issue, b.issue) >= similarityThreshold;
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
  const clusters = [];
  const incomplete = [];
  const unparsed = [];
  // A lens that looked and found nothing is indistinguishable, in its output,
  // from one running below the capability its questions require: both return
  // NO FINDINGS. crosscheck cannot tell them apart, so it counts them and says
  // so rather than folding silence into a clean result.
  const silent = [];
  // An abstention that named what it examined is a test that came back
  // negative — evidence. One that named nothing is a lens whose testing cannot
  // be established at all. Both found nothing; only one of them looked on the
  // record.
  const unsupported = [];

  for (const report of reports ?? []) {
    if (!report || report.findings == null) {
      incomplete.push(report?.lens ?? '<unknown>');
      continue;
    }
    if (report.findings.length === 0) {
      silent.push(report.lens ?? '<unknown>');
      if (!(report.coverage ?? []).length) {
        unsupported.push(report.lens ?? '<unknown>');
      }
    }
    for (const line of report.unparsed ?? []) {
      unparsed.push({ lens: report.lens, line });
    }
    for (const finding of report.findings) {
      let severity = normalizeSeverity(finding.severity);
      if (typeof escalate === 'function') {
        severity = escalate(finding, severity) ?? severity;
      }
      // Match against clusters rather than a hash key: independently written
      // prose never collides exactly, and lenses anchor the same defect a few
      // lines apart. An exact-key merge reports zero agreement on real output.
      const existing = clusters.find(c =>
        c.members.some(m => sameFinding(m, finding, options)));
      if (existing) {
        existing.severity = higherSeverity(existing.severity, severity);
        if (!existing.lenses.includes(report.lens)) {
          existing.lenses.push(report.lens);
        }
        if (!existing.fix && finding.fix) {
          existing.fix = finding.fix;
        }
        // Report the earliest anchor, so the location is stable regardless of
        // which lens happened to run first.
        if (finding.line < existing.line) {
          existing.line = finding.line;
        }
        existing.members.push(finding);
        existing.alsoReported.push({ lens: report.lens, issue: finding.issue });
        continue;
      }
      clusters.push({
        file: finding.file,
        line: finding.line,
        issue: finding.issue,
        fix: finding.fix ?? null,
        severity,
        lenses: [report.lens],
        members: [finding],
        alsoReported: []
      });
    }
  }

  const findings = clusters.map(c => {
    const { members, ...rest } = c;
    const finding = {
      ...rest,
      consensus: c.lenses.length > 1,
      consensusScore: consensusScore(c.lenses, overlap),
      // How many reports collapsed into this entry. Clustering is transitive —
      // a run of similar findings on consecutive lines chains into one — so a
      // collapse much larger than the lens count needs to be visible rather
      // than looking like a single finding.
      occurrences: members.length,
      lines: [...new Set(members.map(m => m.line))].sort((a, b) => a - b)
    };
    // The key is derived after clustering, from the reported anchor and the
    // representative issue, so a baseline stays stable across runs.
    finding.key = findingKey(finding);
    return finding;
  });

  // Severity first, then the strength of independent confirmation, then
  // location so the order is stable across runs.
  findings.sort((a, b) =>
    SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) ||
    b.consensusScore - a.consensusScore ||
    a.file.localeCompare(b.file) ||
    a.line - b.line);

  return { findings, incomplete, unparsed, silent, unsupported };
}

// Apply refutation verdicts from a verify pass. verdicts is keyed by finding
// key: {tested: boolean, refuted: boolean, reason?}. Refuted findings are
// removed from the report and returned separately — a dropped finding that
// vanishes without a count is indistinguishable from one that was never found.
//
// `untested` is the third outcome, and it is not a detail. A finding that
// withstood a genuine attempt to refute it has been tested and survived; one
// whose verifier produced nothing usable has been through no test at all.
// Both remain in the report, because neither was refuted — but reporting them
// as the same thing would let an absent test read as a passed one.
export function applyVerdicts(findings, verdicts) {
  const kept = [];
  const refuted = [];
  const untested = [];
  for (const finding of findings ?? []) {
    const verdict = verdicts?.[finding.key];
    if (verdict?.refuted) {
      refuted.push({ ...finding, refutedReason: verdict.reason ?? null });
      continue;
    }
    kept.push(finding);
    if (verdict && verdict.tested === false) {
      untested.push({ ...finding, untestedReason: verdict.reason ?? null });
    }
  }
  return { findings: kept, refuted, untested };
}

export function countsBySeverity(findings) {
  const counts = { BLOCK: 0, FIX: 0, CONSIDER: 0 };
  for (const finding of findings ?? []) {
    counts[finding.severity] += 1;
  }
  return counts;
}

// `participation` is {total, silent: [lens]}. A clean panel means something
// different depending on how much of it spoke: four lenses examining a file and
// finding nothing is evidence, and one lens finding nothing while three returned
// NO FINDINGS is the absence of evidence. Reporting both as "Ship" is the one
// silent failure this tool otherwise refuses everywhere.
export function panelVerdict(counts, participation = null) {
  if (counts.BLOCK > 0) {
    return 'Do not ship — blockers present';
  }
  if (counts.FIX > 0) {
    return 'Fix before merge';
  }
  const silent = participation?.silent ?? [];
  const unsupported = participation?.unsupported ?? silent;
  const total = participation?.total ?? 0;
  if (silent.length === 0 || total === 0) {
    return 'Ship';
  }
  // Every lens abstaining without showing its work is the case that reads as a
  // pass and is not one. Every lens abstaining WITH coverage is a real result:
  // they looked, they said where, and they found nothing.
  if (silent.length >= total && unsupported.length >= total) {
    return 'No signal — every lens reported nothing and none stated what it ' +
      'examined. This is not a pass; a panel that found nothing anywhere has ' +
      'not been shown to be looking';
  }
  if (unsupported.length === 0) {
    return `Ship — ${silent.length} of ${total} lens(es) found nothing and ` +
      'each stated the coverage it examined';
  }
  return `Ship, with ${unsupported.length} of ${total} lens(es) reporting ` +
    `nothing and stating no coverage (${unsupported.join(', ')}) — for those, ` +
    'clean and unexamined are indistinguishable';
}
