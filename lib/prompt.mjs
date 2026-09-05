/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Build the prompt sent to one lens.
//
// This is the piece that has to be right for the whole pipeline to work: the
// output contract in the prompt is what `parse.mjs` expects on the way back. They
// are two halves of one agreement, so the contract text lives here rather than
// being retyped by every caller.

export const CONTRACT_LINE =
  'file:line — SEVERITY — issue — fix';

// Positive controls live under a path that cannot collide with the repository
// under review, so a finding about a control is separable from a finding about
// real code by its path alone.
export const CONTROL_PREFIX = 'crosscheck-control://';

// The frontmatter is routing metadata — globs, cites, owns — consumed by the
// router before dispatch. Sending it to the model costs tokens on every call and
// tells it nothing it needs, so the body is what gets inlined.
function formatSpans(spans) {
  return spans
    .map(([start, end]) => start === end ? `${start}` : `${start}-${end}`)
    .join(', ');
}

export function stripFrontmatter(text) {
  return String(text ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

// The source block is the only large, invariant part of a lens prompt, so it
// leads. Providers discount an input prefix that is byte-identical to a previous
// request; with the lens definition first, consecutive lenses shared almost
// nothing and qualified for almost none of that. Files are sorted so the prefix
// does not depend on the order the router happened to produce.
function numberLines(content, keep) {
  const lines = String(content).split('\n');
  const out = [];
  let elided = 0;
  const flush = () => {
    if (elided > 0) {
      out.push(`     ... ${elided} line(s) elided, unchanged by this review ...`);
      elided = 0;
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (keep && !keep.has(i + 1)) {
      elided += 1;
      continue;
    }
    flush();
    out.push(`${String(i + 1).padStart(6)}  ${lines[i]}`);
  }
  flush();
  return out.join('\n');
}

// `scope: hunks` trades context for cost: a lens that only judges the lines a
// change touched does not need the other 1,900 in the file. Lenses that follow
// data across a file (taint) or judge structure (architect) must not use it.
function keepSet(spans, total, context) {
  if (!spans || spans.length === 0) {
    return null;
  }
  const keep = new Set();
  for (const [from, to] of spans) {
    const lo = Math.max(1, from - context);
    const hi = Math.min(total, to + context);
    for (let n = lo; n <= hi; n += 1) {
      keep.add(n);
    }
  }
  return keep;
}

export function sharedSourcePrefix(files, options = {}) {
  const { sources = null, rangesByFile = null, scope = 'file',
          hunkContext = 6 } = options;
  if (!sources) {
    return '';
  }
  const ordered = [...files].sort();
  const missing = ordered.filter(f => typeof sources[f] !== 'string');
  if (missing.length) {
    // Reviewing a file whose content never arrived is the failure this whole
    // change exists to remove: the model answers about nothing and looks clean.
    throw new Error(
      `no source available to embed for: ${missing.join(', ')}`);
  }
  const blocks = ordered.map(f => {
    const content = sources[f];
    const keep = scope === 'hunks'
      ? keepSet(rangesByFile?.[f], String(content).split('\n').length,
                hunkContext)
      : null;
    return `===== ${f} =====\n${numberLines(content, keep)}`;
  });
  // The path list is restated after the source rather than left implicit in the
  // block headers: a finding is only useful if it cites the path the caller
  // knows, and the exact spelling is what the parser matches on.
  const ranges = rangesByFile ?? {};
  const list = ordered.map(f => {
    const spans = ranges[f] ?? [];
    return spans.length
      ? `  - ${f}  (changed lines: ${formatSpans(spans)})`
      : `  - ${f}`;
  }).join('\n');

  return 'Review the source below. It is reproduced here in full — do not open ' +
    'any file, and cite the line numbers shown.\n\n' +
    '--- BEGIN SOURCE ---\n\n' + blocks.join('\n\n') +
    '\n\n--- END SOURCE ---\n\n' +
    `Your scope is exactly these ${ordered.length} file(s). Cite them by these ` +
    `paths:\n${list}`;
}

// A lens that reports on everything is useless, and a lens that quietly reviews
// outside its remit corrupts the consensus signal — so both halves of its scope
// are restated in the prompt, not just the part it owns.
export function buildLensPrompt(lens, files, options = {}) {
  const {
    definitionPath = null,
    definition = null,
    mixedCorpus = false,
    rangesByFile = null,
    sources = null,
    hunkContext = 6,
    extra = null
  } = options;

  if (!lens?.name) {
    throw new Error('buildLensPrompt requires a lens with a name');
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`no files in scope for lens ${lens.name}`);
  }

  const parts = [];

  const embedded = sources
    ? sharedSourcePrefix(files, {
      sources, rangesByFile, scope: lens.scope ?? 'file', hunkContext
    })
    : '';

  parts.push(`You are running the **${lens.name}** audit lens.`);

  if (definition) {
    const body = stripFrontmatter(definition);
    if (!body) {
      throw new Error(
        `lens ${lens.name} has frontmatter but no body to adopt`);
    }
    parts.push(
      'Adopt this lens completely — its method, its framing, its severity ' +
      'scale, and its output contract:\n\n' +
      '--- BEGIN LENS DEFINITION ---\n' + body +
      '\n--- END LENS DEFINITION ---');
  } else if (definitionPath) {
    parts.push(
      `Read \`${definitionPath}\` and adopt it completely — its method, its ` +
      'framing, its severity scale, and its output contract.');
  } else {
    throw new Error(
      `lens ${lens.name} has neither a definition nor a definitionPath`);
  }

  if (lens.owns) {
    parts.push(`You own: ${lens.owns}`);
  }
  if (lens['not-owns']) {
    parts.push(
      `You do NOT own: ${lens['not-owns']}. Another lens covers those; ` +
      'reporting them here duplicates that lens and weakens the panel.');
  }

  // The source follows the lens's framing rather than leading the prompt.
  // Leading with it was chosen so consecutive lenses would share a cacheable
  // prefix, and measured on the calibration fixture that cost more than the
  // caching could return: same model, same lens, same code, `check` scored
  // 57.1% recall with the definition first and 0.0% with the source first. A
  // model that reads ten thousand tokens of code before being told which lens
  // it is has already read them as nobody in particular. The caching win was
  // never measured; this loss was. See ADR 0003.
  if (embedded) {
    parts.push(embedded);
  }

  const ranges = rangesByFile ?? {};
  const hasRanges = files.some(f => (ranges[f] ?? []).length > 0);

  if (!embedded) {
    parts.push(
      `Audit exactly these ${files.length} file(s), reading each one completely ` +
      'before reporting on it:\n' +
      files.map(f => {
        const spans = ranges[f] ?? [];
        return spans.length
          ? `  - ${f}  (changed lines: ${formatSpans(spans)})`
          : `  - ${f}`;
      }).join('\n'));
  }

  if (hasRanges) {
    // Reporting only inside the diff would miss the common case: a change that
    // breaks something it did not touch. The changed lines are the priority, not
    // the boundary.
    parts.push(
      'This is a review of a change. The changed lines are listed above — use ' +
      'the surrounding code for context, and concentrate on what the change ' +
      'introduces or breaks. A defect elsewhere is still worth ' +
      'reporting when the change causes it or depends on it; a pre-existing ' +
      'defect the change does not touch is not what this review is for.');
  }

  if (mixedCorpus) {
    parts.push(
      'Some of these files are safe. Report a file ONLY when you can state the ' +
      'specific reason it is defective. A wrong finding costs more than a ' +
      'missed one, so silence is the correct answer wherever you cannot make ' +
      'the case.');
  }

  // Invariants are rendered as two labelled halves on purpose. A rule that says
  // only what to look at produces a model that enumerates the offending site
  // and records it as acceptable — measured, not theorised — so the rule for
  // what an observation MEANS is given equal weight and its own heading.
  const invariants = lens.invariants ?? [];
  if (invariants.length) {
    parts.push(
      'Work through each invariant below in order. They are mechanical: find ' +
      'the sites, then apply the stated rule. Do not skip one because it ' +
      'looks unlikely to apply — say what you examined for it.\n\n' +
      invariants.map(inv =>
        `### ${inv.id} — ${inv.title}\n\n` +
        `**What to look at.** ${inv.observe}\n\n` +
        `**What it means.** ${inv.verdict}`).join('\n\n'));
  }

  // Controls are appended AFTER the shared source block, never inside it. They
  // are per-lens, and putting them in the block would give every lens a
  // different prefix — costing exactly the caching that block exists to buy.
  //
  // What a control establishes is narrow and worth stating: catching it shows
  // the runner can perform this check. It does not show the runner found the
  // real defects. Missing it shows it cannot, which is the case that otherwise
  // arrives as a clean bill of health.
  const controls = invariants.filter(inv => inv.canary);
  if (controls.length) {
    parts.push(
      'SCOPE AMENDMENT. The scope stated above covers the repository under ' +
      'review. These control files are in scope as well — review them under ' +
      'the same invariants and report on them with the same rules, citing ' +
      'them by the paths shown here. Do not exclude them because the earlier ' +
      'scope line did not list them; this instruction supersedes it.\n\n' +
      controls.map(inv =>
        `===== ${CONTROL_PREFIX}${inv.id}.js =====\n` +
        numberLines(inv.canary, null)).join('\n\n'));
  }

  if (extra) {
    parts.push(extra);
  }

  parts.push('Do not edit any file. This lens reports.');

  // Ordering is load-bearing and was measured twice. A trailing NO FINDINGS
  // made abstention the salient act and four lenses went silent. Moving
  // COVERAGE last then made *stating coverage* the salient act, and two lenses
  // without invariants lost most of their recall. What goes last is the
  // instruction to report findings, because that is the job.
  const coverage = invariants.length
    ? 'First, state what you examined — one COVERAGE line per invariant, ' +
      'whether or not it found anything:\n\n' +
      '  COVERAGE: <invariant id> — the sites you examined for it\n\n' +
      'An invariant you could not check says that, and why.'
    : 'First, state what you examined:\n\n' +
      '  COVERAGE: scope — the sites you examined and the property you ' +
      'checked for';

  parts.push(
    coverage + '\n\nThen report every finding, one per line, in exactly this ' +
    `form:\n\n  ${CONTRACT_LINE}\n\n` +
    'SEVERITY is BLOCK, FIX, or CONSIDER. Give the path as listed above. No ' +
    'preamble, no summary, no commentary between findings. If nothing in ' +
    'scope is relevant to your lens, write exactly NO FINDINGS after your ' +
    'COVERAGE lines.\n\n' +
    'Report every defect you can state a trigger for. Finding them is the ' +
    'task; the coverage lines only record where you looked.');

  return parts.join('\n\n');
}

// The verification pass. `foreman.md` has always called for refuting every
// BLOCK by default, on the grounds that a panel which cries wolf stops being
// read. The skeptic is given the file rather than the finding's own account of
// it, and told to default to refuted when the evidence is not there — a verifier
// that accepts a plausible story adds cost and no signal.
export function buildRefutePrompt(finding, options = {}) {
  const { extra = null } = options;
  if (!finding?.file) {
    throw new Error('buildRefutePrompt requires a finding with a file');
  }
  const parts = [
    'You are verifying one claimed defect. Your job is to REFUTE it.',
    `Claim: ${finding.file}:${finding.line} — ${finding.issue}` +
      (finding.fix ? `\nProposed fix: ${finding.fix}` : ''),
    `Read \`${finding.file}\` yourself. Do not take the claim's description of ` +
    'the code as accurate — check it. Then decide:\n\n' +
    '  - Is the code actually as the claim describes?\n' +
    '  - Can you name a concrete input, state, or sequence that triggers the ' +
    'defect?\n' +
    '  - Does something already in the code prevent it — a guard, a validation, ' +
    'a caller contract, a type?',
    'Default to refuted. If you cannot demonstrate the defect is real, it is ' +
    'refuted. A finding that survives only because nobody could disprove it is ' +
    'the kind this pass exists to remove.'
  ];
  if (extra) {
    parts.push(extra);
  }
  parts.push(
    'Reply with exactly one line:\n\n' +
    '  REFUTED — why the claim does not hold\n' +
    'or\n' +
    '  CONFIRMED — the concrete trigger you verified\n\n' +
    'No preamble, no other text.');
  return parts.join('\n\n');
}

const REFUTED = /^\s*REFUTED\b/i;
const CONFIRMED = /^\s*CONFIRMED\b/i;

// The verifier's one job is to refute. Output it could not produce is therefore
// not a refutation — it is the absence of a test, and the two must not resolve
// the same way. This previously returned refuted for unparseable output, which
// dropped the finding: silence counted as evidence against it, while a verifier
// that exited non-zero left the same finding standing. Same event, opposite
// outcomes, and the wrong one was the quiet one.
//
// `tested` records whether a verdict was actually reached, so a caller can tell
// a finding that survived a test from one that was never put to it. A finding
// that no verifier reached is neither refuted nor corroborated.
export function parseVerdict(text) {
  const line = String(text ?? '').trim().split('\n')
    .find(l => REFUTED.test(l) || CONFIRMED.test(l)) ?? '';
  if (CONFIRMED.test(line)) {
    return {
      tested: true,
      refuted: false,
      reason: line.replace(CONFIRMED, '').replace(/^\s*[—-]\s*/, '').trim() || null
    };
  }
  if (REFUTED.test(line)) {
    return {
      tested: true,
      refuted: true,
      reason: line.replace(REFUTED, '').replace(/^\s*[—-]\s*/, '').trim() || null
    };
  }
  return {
    tested: false,
    refuted: false,
    reason: 'verifier produced no usable verdict — the finding was not tested'
  };
}
