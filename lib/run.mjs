/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Plan and execute a panel.
//
// crosscheck does not talk to a model. It builds the prompts, decides the roster,
// fans out, and merges what comes back — the caller supplies a command that turns
// a prompt into text. That keeps the tool agnostic about which agent framework or
// model you use, and keeps this module testable with a fake executor.
//
// The executor contract: exec({prompt, lens}) resolves to
// {stdout, stderr?, code?}. A non-zero code, a thrown error, or empty stdout all
// mean that lens did not produce a report — recorded as incomplete, never
// silently treated as "found nothing".

import { buildLensPrompt } from './prompt.mjs';
import { applyOverrides, routeRoster } from './lenses.mjs';
import { parseLensOutput } from './parse.mjs';

export const DEFAULT_CONCURRENCY = 4;

// lenses: [{name, when, owns, 'not-owns', definition?, definitionPath?}]
// Returns {roster, skipped} — skipped always carries a reason, because a lens
// dropped without one reads as coverage that never happened.
export function planRun(lenses, files, overrides = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('no files in scope — nothing to audit');
  }
  const routed = routeRoster(lenses, files);
  const { roster, skipped } = applyOverrides(routed, overrides);
  // A file that no rostered lens will read is a hole in the coverage. Reporting
  // the file count without it lets a run look complete when part of the target
  // was never examined.
  const covered = new Set(roster.flatMap(l => l.files));
  const unmatched = files.filter(f => !covered.has(f));
  if (overrides.only?.length) {
    const known = new Set((lenses ?? []).map(l => l.name));
    for (const name of overrides.only) {
      if (!known.has(name)) {
        throw new Error(`--only names an unknown lens: ${name}`);
      }
    }
  }
  return { roster, skipped, unmatched };
}

export function promptsFor(roster, options = {}) {
  return roster.map(lens => ({
    lens: lens.name,
    files: lens.files,
    prompt: buildLensPrompt(lens, lens.files, {
      definition: lens.definition,
      definitionPath: lens.definitionPath,
      ...options
    })
  }));
}

// Bounded-concurrency map that preserves input order. Kept local rather than
// pulling in a dependency for nine lines.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) {
          return;
        }
        results[index] = await worker(items[index], index);
      }
    });
  await Promise.all(runners);
  return results;
}

// Returns reports in the shape mergeFindings consumes, plus what was skipped and
// what failed. `findings: null` marks a lens that did not complete.
export async function runPanel({
  roster,
  skipped = [],
  exec,
  concurrency = DEFAULT_CONCURRENCY,
  promptOptions = {},
  onLensStart = null,
  onLensDone = null
} = {}) {
  if (typeof exec !== 'function') {
    throw new Error('runPanel requires an exec function');
  }
  const jobs = promptsFor(roster ?? [], promptOptions);
  const failures = [];

  const reports = await mapLimit(jobs, concurrency, async job => {
    onLensStart?.(job.lens);
    let result;
    try {
      result = await exec({ prompt: job.prompt, lens: job.lens, files: job.files });
    } catch (error) {
      failures.push({ lens: job.lens, reason: error?.message ?? String(error) });
      onLensDone?.(job.lens, { ok: false });
      return { lens: job.lens, findings: null, unparsed: [], output: null };
    }
    const code = result?.code ?? 0;
    const stdout = String(result?.stdout ?? '');
    if (code !== 0) {
      failures.push({
        lens: job.lens,
        reason: `exec exited ${code}` +
          (result?.stderr ? `: ${String(result.stderr).trim().slice(0, 500)}` : '')
      });
      onLensDone?.(job.lens, { ok: false });
      return { lens: job.lens, findings: null, unparsed: [], output: null };
    }
    if (stdout.trim() === '') {
      failures.push({
        lens: job.lens,
        reason: 'exec produced no output; a lens with nothing to report must ' +
          'say NO FINDINGS'
      });
      onLensDone?.(job.lens, { ok: false });
      return { lens: job.lens, findings: null, unparsed: [], output: null };
    }
    const { findings, unparsed } = parseLensOutput(stdout);
    onLensDone?.(job.lens, { ok: true, findings: findings.length });
    // `output` is the verbatim lens text, kept so `--out` can save a run and it
    // can be rescored later without paying the model again.
    return { lens: job.lens, findings, unparsed, output: stdout };
  });

  return { reports, skipped, failures };
}
