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

import { buildLensPrompt, buildRefutePrompt, parseVerdict } from './prompt.mjs';
import { applyOverrides, routeRoster } from './lenses.mjs';
import { parseLensOutput } from './parse.mjs';

export const DEFAULT_CONCURRENCY = 4;

// Which command runs a given lens. A conventions lens checking copyright years
// does not need what a security lens needs, and cost is what decides whether a
// team leaves this switched on. Precedence: the lens's own `exec`, then a
// per-lens entry in the config's exec map, then the single default.
export function resolveExec(lens, exec) {
  if (lens?.exec) {
    return lens.exec;
  }
  if (exec && typeof exec === 'object') {
    return exec[lens?.name] ?? exec.default ?? null;
  }
  return exec ?? null;
}

// crosscheck cannot see tokens or money — `--exec` is an arbitrary command — so
// the only unit it can honestly cap is the number of dispatches. Pretending to
// budget dollars would be a number made up from nothing.
export function planBudget(jobs, maxDispatches) {
  if (maxDispatches == null || maxDispatches >= (jobs ?? []).length) {
    return { run: jobs ?? [], dropped: [] };
  }
  if (maxDispatches <= 0) {
    return { run: [], dropped: jobs ?? [] };
  }
  return {
    run: jobs.slice(0, maxDispatches),
    dropped: jobs.slice(maxDispatches)
  };
}

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

// Refute each finding independently, bounded by the same concurrency cap. Returns
// verdicts keyed by finding key, plus any verifier that failed — a verifier that
// did not run must not be read as agreement, so its finding is left standing and
// the failure is reported.
export async function verifyFindings({
  findings,
  exec,
  concurrency = DEFAULT_CONCURRENCY,
  onVerdict = null
} = {}) {
  if (typeof exec !== 'function') {
    throw new Error('verifyFindings requires an exec function');
  }
  const targets = findings ?? [];
  const verdicts = {};
  const failures = [];
  await mapLimit(targets, concurrency, async finding => {
    let result;
    try {
      result = await exec({
        prompt: buildRefutePrompt(finding),
        lens: `verify:${finding.lenses?.[0] ?? 'finding'}`,
        files: [finding.file]
      });
    } catch (error) {
      failures.push({
        finding: finding.key, reason: error?.message ?? String(error)
      });
      return;
    }
    if ((result?.code ?? 0) !== 0) {
      failures.push({
        finding: finding.key, reason: `verifier exited ${result?.code}`
      });
      return;
    }
    const verdict = parseVerdict(result?.stdout);
    verdicts[finding.key] = verdict;
    onVerdict?.(finding, verdict);
  });
  return { verdicts, failures };
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
  cache = null,
  cacheKeyFor = null,
  maxDispatches = null,
  onLensStart = null,
  onLensDone = null,
  onCacheHit = null
} = {}) {
  if (typeof exec !== 'function') {
    throw new Error('runPanel requires an exec function');
  }
  const allJobs = promptsFor(roster ?? [], promptOptions);
  const failures = [];

  // Truncation is disclosed, never silent: a run that quietly stopped early
  // looks exactly like a run that found nothing.
  const { run: jobs, dropped } = planBudget(allJobs, maxDispatches);

  const reports = await mapLimit(jobs, concurrency, async job => {
    onLensStart?.(job.lens);
    const key = cache && cacheKeyFor ? cacheKeyFor(job) : null;
    if (key) {
      const cached = cache.get(key, job.lens);
      if (cached != null) {
        const { findings, unparsed } = parseLensOutput(cached);
        onCacheHit?.(job.lens);
        onLensDone?.(job.lens, {
          ok: true, findings: findings.length, cached: true
        });
        return { lens: job.lens, findings, unparsed, output: cached };
      }
    }
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
    if (key) {
      cache.set(key, job.lens, stdout);
    }
    onLensDone?.(job.lens, { ok: true, findings: findings.length });
    // `output` is the verbatim lens text, kept so `--out` can save a run and it
    // can be rescored later without paying the model again.
    return { lens: job.lens, findings, unparsed, output: stdout };
  });

  return {
    reports,
    skipped,
    failures,
    dropped: dropped.map(j => ({ lens: j.lens, files: j.files.length })),
    cacheStats: cache?.stats ?? null
  };
}
