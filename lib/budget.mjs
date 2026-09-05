/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */
// Estimating the input a run will send, and capping it.
//
// crosscheck used to be unable to say anything about cost: `--exec` is an
// arbitrary command, so the only unit it could honestly cap was dispatches.
// Embedding source changed that — the prompt is now built here, so the input
// side of a run is knowable before anything is spent.
//
// What is still not knowable: the runner's own preamble, its tool calls, its
// reasoning tokens, and every output token. A measured agent CLI added roughly
// 15k tokens of its own before seeing the prompt at all. So this counts the
// input crosscheck constructs and calls it an estimate, in those words,
// everywhere it appears. A number presented as exact would be the same invented
// figure the dispatch cap was written to avoid.

// Tokenisers differ per model and none of them is available here. Code runs
// denser than prose, so this errs low on characters-per-token, which errs high
// on the resulting count: overshooting a budget is a smaller failure than
// quietly exceeding one.
export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text) {
  const s = String(text ?? '');
  return s.length === 0 ? 0 : Math.ceil(s.length / CHARS_PER_TOKEN);
}

// Roster order is the priority order, which is the lens author's and the
// config's, not a ranking crosscheck invents. A lens that does not fit is
// dropped and named — the same contract --max-dispatches already holds to,
// because a run that quietly stopped early looks exactly like a clean one.
export function planTokenBudget(jobs, budget) {
  const all = jobs ?? [];
  const costs = all.map(j => estimateTokens(j.prompt));
  const estimated = costs.reduce((a, b) => a + b, 0);

  if (budget == null || !Number.isFinite(budget)) {
    return { run: all, dropped: [], estimated, budget: null };
  }

  const run = [];
  const dropped = [];
  let spent = 0;
  for (let i = 0; i < all.length; i += 1) {
    if (spent + costs[i] <= budget) {
      run.push(all[i]);
      spent += costs[i];
    } else {
      // Job objects, matching planBudget: the caller reports both the same way,
      // and a shape that differed here rendered as an empty name and announced
      // nothing at all.
      dropped.push(all[i]);
    }
  }
  return { run, dropped, estimated, spent, budget };
}

export function formatEstimate(estimated, budget) {
  const n = estimated.toLocaleString('en-US');
  return budget == null
    ? `estimated input: ~${n} tokens (estimate; excludes the runner's own ` +
      'preamble, reasoning, and all output)'
    : `estimated input: ~${n} tokens against a budget of ` +
      `${budget.toLocaleString('en-US')} (estimate; excludes the runner's own ` +
      'preamble, reasoning, and all output)';
}
