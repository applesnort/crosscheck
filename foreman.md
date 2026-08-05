# Crosscheck — the foreman pattern

The roster-agnostic core of a multi-persona audit command. An ensemble /
mixture-of-critics: each persona lens is blind to what the others see, so the
union catches what any single review pass misses, and anything two personas flag
independently gets ranked higher.

The foreman audits nothing itself — it dispatches specialists, collects findings,
and synthesizes. Substitute whatever lens definitions you already have; nothing
below depends on a particular roster.

Two steps precede what's here, both cheap to reconstruct:

- **Step 1 — resolve the target.** Branch or no argument → `git diff origin/main...HEAD`;
  a path or glob → those files; a PR number → `gh pr diff <N>`; a feature name →
  locate the files first. List the concrete files in scope before dispatching, and
  stop if the target is empty.
- **Step 2 — route the roster.** A table mapping each persona to its definition
  file and the condition that makes it relevant, so a lens with nothing to say
  never runs. Print the chosen roster plus a one-line reason for every lens
  skipped — a skipped lens is disclosed, never silently dropped.

## Step 3 — Dispatch as a WORKFLOW, not as inline agents

**Use the `Workflow` tool.** Do NOT spawn one `Agent` per persona.

The roster is fixed and needs no adaptation mid-run, which is exactly what a workflow is for — and critically, a workflow renders its progress as a tree viewable with **`/workflows`** instead of putting one pane per persona inline in the working session. A 9-persona panel dispatched as inline agents floods the session with panes and becomes unreadable, and the run has to be killed to recover it.

The script fans the chosen roster out with `parallel()` and returns the raw findings. Shape:

```js
export const meta = {
  name: 'crosscheck',
  description: 'Run the persona roster against a target and return raw findings',
  phases: [{title: 'Audit', detail: 'one agent per persona lens'}]
}
const PERSONAS = [
  {name: 'check', def: '<path to that lens definition>'},
  // ...only the personas Step 2 chose
]
const TARGET = `...concrete file list or diff spec from Step 1...`
phase('Audit')
const reports = await parallel(PERSONAS.map(p => () => agent(
  `You are running the **${p.name}** audit. Read \`${p.def}\` and fully adopt ` +
  `that persona -- its lens, its adversarial framing, and its exact output ` +
  `format. Audit this target: ${TARGET}. Read every relevant file in scope ` +
  `before responding. Return ONLY findings in your persona's severity format; ` +
  `each finding must be \`file:line -- <severity> -- <issue> -- <fix>\`. If ` +
  `nothing in scope is relevant to your lens, return exactly NO FINDINGS. Do ` +
  `not review anything outside your lens.`,
  {label: `audit:${p.name}`, phase: 'Audit'})))
return PERSONAS.map((p, i) => ({persona: p.name, report: reports[i]}))
```

Notes that matter:
- `parallel()` returns `null` for any agent that died. Report those as "did not complete" — never silently drop one.
- Pass the **concrete file list** resolved in Step 1 into `TARGET`, not the raw argument.
- If the code under audit is being edited concurrently, tell each persona to read a **pinned ref** (`git show <sha>:<path>`) so findings are reproducible.
- Only use `Agent` directly for a **single** follow-up lens, or when a persona needs to be re-run with new information. One or two inline agents is fine; a fleet is not.

## Step 4 — Verify before reporting

**Run this by default, not as an opt-in heavier mode.** False positives cost more
than misses: a panel that cries wolf twice stops being read, and then its true
findings go unread with the rest.

For every `BLOCK`, dispatch one skeptic whose job is to *refute* it — told to
default to refuted when the evidence is not there, and given the file to check
rather than the finding's own summary of it. Drop what gets refuted, and report
the refuted count. A finding that disappears without a number is
indistinguishable from one that was never found.

Scale the pass to the stakes: one skeptic per `BLOCK` is the floor, three with
distinct angles (does it reproduce, is it reachable, is the fix right) for
anything that gates a release.

## Step 5 — Merge, dedupe, escalate

- **Dedupe** by `file:line` + normalized issue. When two+ personas flag the same
  thing, collapse into one entry, list all reporting personas, and mark it
  **CONSENSUS** — list those first within their severity.
- **Normalize severity** to one scale: **BLOCK** (any persona's top tier —
  must-fix / blocker / violation / invisible-failure / data-corrupting /
  critical), **FIX** (middle tier), **CONSIDER** (lowest tier). On conflict, take
  the highest.
- **Weight consensus by independence, not by headcount.** Two personas that
  overlap in remit agreeing is weaker evidence than two that do not. Score a
  finding as *effective independent confirmations*: 1 for a single persona, and
  for a set, 1 plus the summed independence of each distinct pair. Measure
  independence from a calibration run rather than guessing it.
- **Attribute** every finding to the persona(s) that raised it.

This step is deterministic, so it does not need a model. `crosscheck report`
does exactly the above, plus baseline filtering and SARIF output.

## Step 6 — Report

```
# Crosscheck — <target>
Roster run: <personas>   Skipped: <persona: reason, ...>
Did not complete: <persona, ...>   Refuted in verification: <n>

## BLOCK (n)
- [CONSENSUS 2: architect, ux] file:line — issue — fix
- [security-check] file:line — issue — fix

## FIX (n)
- [check] file:line — issue — fix

## CONSIDER (n)
- [ux] file:line — note

## Per-persona verdicts
- security-check: <one-line verdict>   check: <...>   ...

## Panel verdict
<Ship / Fix before merge / Do not ship> — <one sentence>. <n> block, <n> fix, <n> consider; <n> consensus.
```

Three numbers must always appear, even when they are zero: personas skipped,
personas that did not complete, and findings refuted. Each one is a hole in the
coverage, and a report that omits them reads as completeness that was never
there.

## Notes

- Default scale is ~6-9 personas. That is one workflow, not 6-9 inline agents —
  see Step 3. The workflow's own concurrency cap handles pacing; don't chunk the
  roster.
- `--only a,b,c` / `--skip x,y` override the routing, and the override is
  reported like any other skip.
- **On an existing codebase, take a baseline first.** The first run returns
  everything already wrong and the report gets closed unread. Record it with
  `crosscheck baseline`, then later runs report what the change introduced —
  with the suppressed count stated, so the baseline cannot quietly grow into a
  way of declaring problems normal.
- **Calibrate before trusting the ranking.** `crosscheck calibrate` scores a run
  against planted defects and prints consensus precision beside single-persona
  precision. If those two numbers are equal, consensus ranking is decoration on
  your roster and should be reweighted or dropped. Measure it; don't assume it.
