# Roadmap

Ordered by what blocks adoption, not by what is interesting to build.

## Phase 1 — usable on real work

Nobody reviews a directory; they review a change. Auditing whole paths makes cost
scale with repository size instead of change size, which is why this comes first.

- `--diff`, `--staged`, `--since <ref>` — change-scoped targeting
- changed line ranges passed into prompts, so a lens reads the diff in context
  rather than a whole file with no indication of what moved
- the verification pass wired to the CLI. `foreman.md` has always said to refute
  every `BLOCK` by default, and `applyVerdicts` has always existed and been
  tested — it was simply never called. Documented behaviour the tool did not have.
- `preflight` — a command run before dispatch that aborts on non-zero exit. Lets a
  project enforce its own gate (data classification, clean worktree, branch
  policy) without crosscheck knowing anything about it.

## Phase 2 — cheap enough to leave switched on

A tool that costs real money per run gets disabled, and a disabled tool finds
nothing.

- per-lens `exec` or `model` in frontmatter — a conventions lens checking
  copyright years does not need what a security lens needs
- a result cache keyed on file content and lens definition, so unchanged files are
  not re-reviewed
- `--budget` with **disclosed** truncation: when the cap is hit, say which lenses
  or files were dropped. A silent partial run is the failure this tool exists to
  avoid.

## Phase 3 — adoption in one file

- a GitHub Action wrapping `run` plus SARIF upload to code scanning
- PR review comments via `gh`
- `crosscheck init` — scaffold a config, a lens directory, and a workflow

## Phase 4 — Digital Bazaar harness integration

The argument for adoption is not "a review tool". DB's own Tier-1 rule requires
any skill with an LLM in the path to have a way to know if it regressed;
`crosscheck calibrate` is that mechanism, generically, with a CI exit code.

- `lenses/` for DB: house conventions, MongoDB record shape, plain-JavaScript,
  Tier-0 data handling
- a thin skill invoking crosscheck with those lenses, matching how the existing
  db-lint and db-ci skills already shell out
- a calibration fixture of planted DB-convention violations, wired into CI

`.ai-class` stays out of crosscheck. Data classification is DB policy and does not
belong in a general tool — the `preflight` hook from Phase 1 is how DB enforces it.

## Phase 5 — the measured bias

Across six calibration rounds, severity was under-called in 7 of 8 mismatches.
`calibrate` measures that and does nothing with it. A per-lens severity correction
derived from calibration data would be a capability no comparable tool has.

## Deliberately not building

- **Model integrations.** `--exec` agnosticism is the design's spine. A built-in
  API client adds dependencies and picks sides.
- **A dashboard.** SARIF consumers already exist and are better than anything
  written here.
- **More packaged lenses.** Generic lenses are shallow by construction. The value
  is in local ones, which is why local lenses are documented as first-class.
- **Further consensus experiments.** Six rounds closed that question; reopening it
  needs real production code with independently authored ground truth and new
  criteria fixed in advance. See `fixtures/calibration/PREREGISTERED.md`.
