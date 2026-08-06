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

// A lens that reports on everything is useless, and a lens that quietly reviews
// outside its remit corrupts the consensus signal — so both halves of its scope
// are restated in the prompt, not just the part it owns.
export function buildLensPrompt(lens, files, options = {}) {
  const {
    definitionPath = null,
    definition = null,
    mixedCorpus = false,
    rangesByFile = null,
    extra = null
  } = options;

  if (!lens?.name) {
    throw new Error('buildLensPrompt requires a lens with a name');
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`no files in scope for lens ${lens.name}`);
  }

  const parts = [];
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

  const ranges = rangesByFile ?? {};
  const hasRanges = files.some(f => (ranges[f] ?? []).length > 0);
  parts.push(
    `Audit exactly these ${files.length} file(s), reading each one completely ` +
    'before reporting on it:\n' +
    files.map(f => {
      const spans = ranges[f] ?? [];
      return spans.length
        ? `  - ${f}  (changed lines: ${formatSpans(spans)})`
        : `  - ${f}`;
    }).join('\n'));

  if (hasRanges) {
    // Reporting only inside the diff would miss the common case: a change that
    // breaks something it did not touch. The changed lines are the priority, not
    // the boundary.
    parts.push(
      'This is a review of a change. The changed lines are listed above — read ' +
      'each file completely for context, and concentrate on what the change ' +
      'introduces or breaks. A defect elsewhere in the file is still worth ' +
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

  if (extra) {
    parts.push(extra);
  }

  parts.push('Do not edit any file. This lens reports.');

  parts.push(
    'Reply with ONLY finding lines, one per line, in exactly this form:\n\n' +
    `  ${CONTRACT_LINE}\n\n` +
    'SEVERITY is BLOCK, FIX, or CONSIDER. Give the path as listed above. No ' +
    'preamble, no summary, no commentary between findings. If nothing in scope ' +
    'is relevant to your lens, reply with exactly:\n\n  NO FINDINGS');

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

// An unparseable verdict is treated as refuted, matching the default above: a
// verifier that produced nothing usable has not established the finding.
export function parseVerdict(text) {
  const line = String(text ?? '').trim().split('\n')
    .find(l => REFUTED.test(l) || CONFIRMED.test(l)) ?? '';
  if (CONFIRMED.test(line)) {
    return {
      refuted: false,
      reason: line.replace(CONFIRMED, '').replace(/^\s*[—-]\s*/, '').trim() || null
    };
  }
  return {
    refuted: true,
    reason: line
      ? line.replace(REFUTED, '').replace(/^\s*[—-]\s*/, '').trim() || null
      : 'verifier produced no usable verdict'
  };
}
