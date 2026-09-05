# Changelog

Notable changes to `@applesnort/crosscheck`. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semver](https://semver.org/), pre-1.0, so a minor bump is where behaviour
changes land.

Entries before 0.7.0 were reconstructed from commit history after the fact, so
they name what each version did rather than itemising every change in it.

**Published to npm: 0.2.0, 0.2.1, 0.2.2, 0.3.0, 0.6.0, 0.7.0, 0.7.1.** 0.4.0, 0.5.0,
0.6.1 and 0.6.2 exist as versions in this repository but were never published,
so a consumer resolving `@0.6` gets 0.6.0 and none of the fixes after it.

## [0.9.0] — 2026-09-04

Token cost. crosscheck could not previously say anything about what a run would
spend: `--exec` is an arbitrary command, so dispatches were the only unit it
could cap. Embedding the source makes the input side knowable, and everything
here follows from that.

### Added

- **Source is embedded in lens prompts, and leads them.** A prompt used to name
  its files and expect the runner to open them, so only an agent could run one;
  a bare model returned `NO FINDINGS` on a fixture with seven planted defects
  because it had nothing to look at. Source now appears in the prompt,
  line-numbered, with files sorted so the block is byte-identical across every
  lens routed to the same set — which is what a provider prefix cache needs.
  `--no-embed` restores the previous prompt.
- **`--budget N`** caps estimated input tokens, dropping lenses in roster order
  and naming each one. The estimate prints on every run, capped or not, and is
  labelled an estimate wherever it appears: it counts the prompt crosscheck
  builds, never the runner's preamble, reasoning, or output.
- **`--triage '<cheap command>'`** runs a cheap pass over the whole target, then
  the real panel over only the files it flagged. The narrowing is always
  reported, and a run where triage flagged nothing says the verdict is the cheap
  pass's. A lens that failed during triage is not read as a clean file.
- **`scope: hunks`** in lens frontmatter sends only changed lines plus context.
  `--hunk-context N` sets the margin.
- **`effort: low | medium | high`** in lens frontmatter reaches the runner as
  `CROSSCHECK_EFFORT`, alongside `CROSSCHECK_LENS` and `CROSSCHECK_SCOPE`.
- **ADR 0001** records the embedding decision, including the alternatives
  rejected and what it costs when it is the wrong call.

### Changed

- `--max-dispatches` no longer describes itself as the only unit that can be
  capped; `--budget` now caps tokens. Both still name what they dropped.
- An unreadable in-scope file stops the run rather than being reviewed as a gap.

### Notes

Embedding sends the whole in-scope source for each routing group, whether or not
a runner would have opened all of it. For a large file set against an agent that
reads selectively this can cost more than it saves — `--no-embed` is the exit.

## [0.8.0] — unreleased

### Fixed

- **`.example` files were reviewed by no lens.** The code lenses route by
  extension, so `configs/local.js.example`, `settings.py.example` and every
  other `<name>.<ext>.example` matched nothing — and because each lens that
  skipped it reported "nothing in scope matches", the run still read as
  complete. Only the `UNREVIEWED` line named the file.

  This is the same failure mode as the Windows glob bug fixed in 0.7.1:
  coverage narrows and nothing says so. It is worth closing because an
  `.example` file is where copy-pasted setup instructions live, and a wrong
  instruction there is followed rather than reviewed — in the change that
  surfaced this, a 36-line `.example` carried the majority of the diff's
  substantive claims and three of them were wrong.

  `architect`, `check`, `security-check` and `taint` now route `**/*.example`.
  `ux` deliberately does not: an example file is not an interface.

  This is a minor rather than a patch because it changes which files a lens
  reads, so a run over the same diff can now produce findings it did not
  before, and costs more.

## [0.7.1] — 2026-08-20

### Fixed

- **crosscheck could not run on Windows at all.** The packaged lens directory
  was resolved with `new URL(...).pathname`, which is a URL path rather than a
  filesystem one: on Windows it carries a leading slash before the drive letter
  (`/C:/Users/...`). `readdirSync` threw an uncaught `ENOENT` before any command
  that loads the built-in lenses could do anything, so `run` and `lenses` died
  on a raw Node stack trace.

  The same bug broke **every platform** whenever the install path contained a
  space, because a URL path keeps its percent-escapes: `/Users/me/my source/`
  arrived as `/Users/me/my%20source/` and resolved to nothing.

- Config discovery silently stopped working on Windows. `findConfig` walked
  upward using `/` string surgery, so a Windows `cwd` never yielded a parent:
  the search probed the starting directory and gave up. A project's
  `.crosscheckrc.json` was ignored unless you happened to run from the repo
  root — and nothing said so, which is the invisible behaviour this tool rejects
  everywhere else.

- Routing lost every directory-anchored glob on Windows. `collectFiles` reported
  paths with the platform separator, and the matcher only understood `/`.
  Extension globs matched anyway (`[^/]*` eats a backslash), so the roster
  filled and no `UNREVIEWED` line appeared while `**/components/**`,
  `**/migrations/**`, `**/views/**`, `**/pages/**` and `**/schema*` quietly
  matched nothing. Coverage narrowed and the run still reported as complete.

  Paths are now reported with `/` on every platform, which also makes a
  path-mode run agree with the same run under `--diff` — git has always emitted
  `/`.

- SARIF `artifactLocation.uri` is a URI reference, so a Windows path was not
  merely ugly: a backslash is not a separator there and GitHub code scanning
  could not map a result back to its file.

- `npm test` did not work on Windows. The script globbed `test/*.test.mjs`, and
  neither `cmd.exe` nor PowerShell expands a glob for an external command, so
  node received the pattern as a literal. It now uses Node's own test
  discovery.

### Changed

- CI runs the suite on Windows and macOS as well as Linux. Nothing above would
  have reached a user with a Windows job in the matrix, and nothing would catch
  a regression without one.

- The CLI smoke-test stubs are Node scripts rather than `#!/bin/sh` ones, and no
  longer need an execute bit. The suite could not run on Windows either, which
  is the other half of why none of this was caught.

## [0.7.0] — 2026-08-13

### Fixed

- The `check`, `architect`, `security-check` and `taint` lenses now route
  `.vue` and `.svelte` files. They globbed `.js`/`.ts` and friends but not
  single-file components, so only `ux` matched one — a 2437-line Vue component
  in a real review was read by the usability lens and by nothing else, with no
  correctness, security or architecture pass over the largest file in the
  project.

  The run still reported as complete, because each lens that skipped the
  component did so via "nothing in scope matches", which reads as a routing
  decision rather than a hole.

  This is a **behaviour change, not just a fix**: every lens now receives more
  files on any project containing components, so runs there are slower and cost
  more. That is why it is a minor bump rather than a patch.

- `test/lenses.test.mjs` asserts the shipped lenses route both extensions. The
  existing routing test only ever checked a plain `.js` file, which is why the
  gap survived.

Stylesheets remain deliberately unrouted; the CLI naming an unmatched `.css`
file in its `UNREVIEWED` line is intended behaviour, not a further instance of
this bug.

## [0.6.2] — unpublished

- Install the model CLI in the scaffolded workflow.

## [0.6.1] — unpublished

- Do not load the same lens directory twice.

## [0.6.0] — 2026

- Adoption in one command (`crosscheck init`): scaffold config, lenses and
  workflow.

## [0.5.0] — unpublished

- Cost work: make a standing panel cheap enough to leave switched on.

## [0.4.0] — unpublished

- Review a change rather than a tree; verify findings before reporting them;
  gate before dispatch.
- Cancel superseded CI runs instead of queueing them.

## [0.3.0] — 2026

- Layer lens sources, so adding one lens costs one file instead of forking all
  of them.
- Document that a project's own lenses stay in that project.

## [0.2.2] — 2026

- `.crosscheckrc.json`, so a team shares one panel definition instead of a shell
  alias nobody else can see.

## [0.2.1] — 2026

- Disclose unreviewed files; stop sending lens frontmatter to the model.
- CLI smoke tests, and two bugs they found.

## [0.2.0] — 2026

- Publish under the `@applesnort` scope.
