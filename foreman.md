# Audit panel — the foreman pattern

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
  name: 'audit-panel',
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

## Step 4 — Merge, dedupe, escalate

- **Dedupe** by `file:line` + normalized issue. When two+ personas flag the same thing, collapse into one entry, list all reporting personas, and mark it **CONSENSUS** — these are your highest-confidence findings, list them first within their severity.
- **Normalize severity** to one scale: **BLOCK** (any persona's top tier — must-fix / blocker / violation / invisible-failure / data-corrupting / critical), **FIX** (middle tier), **CONSIDER** (lowest tier). On conflict, take the highest.
- **Attribute** every finding to the persona(s) that raised it.

## Step 5 — Report

```
# Audit Panel — <target>
Roster run: <personas>   Skipped: <persona: reason, ...>

## BLOCK (n)
- [CONSENSUS: security, oncall] file:line — issue — fix
- [chaos] file:line — issue — fix

## FIX (n)
- [accessibility] file:line — issue — fix

## CONSIDER (n)
- [ux] file:line — note

## Per-persona verdicts
- security: <one-line verdict>   accessibility: <...>   ...

## Panel verdict
<Ship / Fix blockers first / Do not ship> — <one sentence>. <n> block, <n> fix, <n> consider; <n> consensus findings.
```

## Notes
- Default scale is ~6-9 personas. That is one workflow, not 6-9 inline agents -- see Step 3. The workflow's own concurrency cap handles pacing; don't chunk the roster.
- `--only a,b,c` / `--skip x,y` override the routing.
- This is the reusable version. For a heavier run with adversarial verification of each finding (independent skeptics per BLOCK finding), say "verify" and escalate to a Workflow — but the default panel above is one parallel round + synthesis.
