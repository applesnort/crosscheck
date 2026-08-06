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

  parts.push(
    `Audit exactly these ${files.length} file(s), reading each one completely ` +
    'before reporting on it:\n' + files.map(f => `  - ${f}`).join('\n'));

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
