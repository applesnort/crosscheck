# crosscheck

Run several independent review lenses over the same change in parallel, merge their
findings into one deduped report, and emit it as **SARIF** — so LLM review findings
land in the same places static-analysis findings already do.

```bash
# run a panel: crosscheck builds the prompts and merges the results,
# your --exec command supplies the model
npx @applesnort/crosscheck run lib/ --exec 'claude -p' --sarif panel.sarif

# or merge output a panel already produced
npx @applesnort/crosscheck report --in run.json
```

**crosscheck never talks to a model itself.** `--exec` names any command that takes
one lens prompt on stdin and returns findings on stdout — `claude -p`, `llm -m ...`,
or your own wrapper. crosscheck owns prompt construction, routing, fan-out, dedupe,
and output; you own the model. `--dry-run` prints the roster and prompts without
spawning anything.

No dependencies, no install step, 183 tests.

## Configuration

Retyping `--exec` on every run pushes people toward shell aliases nobody else on
the team can see. Commit a `.crosscheckrc.json` instead:

```json
{
  "exec": "claude -p",
  "concurrency": 2,
  "skip": ["ux"],
  "sarif": "panel.sarif"
}
```

Then the whole command is:

```bash
npx @applesnort/crosscheck run src/
```

The nearest config is used, searching upward from the working directory and
stopping at a repo root, so running from a subdirectory still picks up the
project's settings. The loaded path is printed on every run — a run silently
reshaped by a forgotten file is the kind of thing this tool refuses everywhere
else. Command-line flags override the file, `--config <file>` points elsewhere,
and an unrecognised key is an error rather than a silent no-op, because a
misspelled `exec` that quietly does nothing is worse than a crash.

Accepted keys: `exec`, `lenses`, `concurrency`, `only`, `skip`, `mixed`, `out`,
`sarif`, `baseline`, `overlap`. Keys beginning `//` are treated as comments.

> **v0.x — the API is unstable.** The CLI commands and the `lib/` exports may
> change shape before 1.0. Pin an exact version if you depend on it.
>
> Published as `@applesnort/crosscheck`; npm rejects the unscoped name as too
> similar to the (abandoned) `cross-check`. Installed, the command is
> `crosscheck`.

## SARIF output

Findings are emitted as [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html),
the OASIS interchange format static analyzers already speak. Every other
multi-persona review panel emits prose for a human to read once. This one produces
a document GitHub code scanning, editor problem panels, and security dashboards
already know how to ingest — none of them needing to know a model wrote it.

- One **rule per lens**, carrying the standards that lens cites, so consumers can
  filter and configure by lens.
- `partialFingerprints` for stable identity across runs, independent of severity,
  fix text, and ordering.
- Lens attribution and consensus score ride in `properties`, since SARIF has no
  native concept for either.
- A lens that died sets `executionSuccessful: false` and emits a
  `toolExecutionNotification`. The gap is machine-readable, not a line of prose a
  dashboard will drop.

That last point is the design rule throughout: **every omission is disclosed.** A
lens skipped for irrelevance, a lens whose agent died, and a finding refuted during
verification are three different things and must read differently. A partial panel
presented as a complete one is worse than no panel.

## Why lenses instead of one review pass

A single review pass optimizes for one kind of defect at a time. Ask for "problems"
and you get whichever category the model reaches for first. Ask several narrow
specialists — each told explicitly what it does *not* own — and the union covers
more ground, because none of them is trading correctness findings against usability
findings inside one context.

The panel is a foreman, not a reviewer. It resolves the target, decides which lenses
are relevant, dispatches them, and synthesizes what comes back. The lenses do the
looking; the deterministic half — parse, dedupe, score, emit — is code with tests
rather than prompt instructions. See [`foreman.md`](foreman.md).

## Measuring whether your lenses are redundant

Most implementations stop at "N agents agreed." That over-credits lenses whose
remits overlap: two lenses looking at the same things agreeing tells you less than
two that do not. So overlap is **measured** from a real run rather than assumed:

```bash
crosscheck overlap --in run.json --out overlap.json   # measure it
crosscheck report  --in run.json --overlap overlap.json
```

This has produced discriminating results in both directions on real data. The same
two lenses — written with deliberately opposed methods, a CWE taxonomy walk and
sink-first flow tracing — measured **0.45** overlap against 66 OWASP Benchmark
cases and **1.0** against a 20-case corpus where they returned byte-for-byte
identical detections.

At 1.0, agreement is scored as **one** effective confirmation rather than two,
because that is what it is worth. That is a result you can act on: drop the
redundant lens, or replace it with one that fails differently.

Findings are ranked by those effective confirmations — 1 for a single lens, and for
a set, 1 plus the summed independence of each distinct pair. **Whether that ranking
predicts correctness is unproven**; six calibration rounds could not test it,
because the lenses almost never erred. It is kept as a documented hypothesis rather
than a validated feature — [the full record is here](fixtures/calibration/PREREGISTERED.md),
including every failed prediction.

### Matching is fuzzy, because real lens output is

Two lenses never phrase a defect identically, and they anchor it on different lines.
In one measured run, three lenses each found the same swallowed error and cited it
at lines **54, 56, and 57**. An exact-match merge reports that as three findings and
zero agreement.

So findings cluster on line proximity (±3) **plus** issue similarity — a Jaccard
index over content words, thresholded at `0.12`. Both defaults come from
measurement: same-defect pairs scored `0.161`–`0.538`, while different defects
sharing a line scored `0.038`–`0.050`. The threshold sits in that gap.
`test/merge-realdata.test.mjs` pins both bands using verbatim lens output, so they
cannot drift unnoticed.

## Baselines

On an existing codebase the first run returns everything already wrong, and the
report gets closed unread. Record it, then report only what changed:

```bash
crosscheck baseline --in first-run.json --out .crosscheck-baseline.json
crosscheck report   --in run.json --baseline .crosscheck-baseline.json
```

Suppressed counts are always reported, and baseline entries that stopped appearing
are flagged — either they were fixed, or a lens quietly stopped running. A baseline
that hides its own size is just a way to declare a codebase's problems normal.

## Calibration

A review panel is otherwise unfalsifiable: you cannot tell whether it works, whether
a new lens helped, or whether a prompt edit made it worse.

```bash
crosscheck calibrate --in run.json --expected fixtures/calibration/expected.json
```

reports recall, precision, per-lens recall against only the defects that lens owns,
severity agreement, and consensus precision beside single-lens precision. It exits
non-zero when a planted defect was missed, so it works as a CI gate on the panel
itself. `lib/corpus.mjs` scores externally authored corpora at case level, and
`scripts/fetch-corpus.sh` pulls one without vendoring it.

Six rounds have been run and recorded — two self-authored fixtures, an external
corpus of 2,740 labeled cases, two model tiers, a purpose-built deception corpus,
and a controlled prompt ablation. The results, the criteria fixed in advance of each
round, every failed prediction, and one methodological error that voided a round are
all in [`fixtures/calibration/PREREGISTERED.md`](fixtures/calibration/PREREGISTERED.md).

The short version: the lenses were nearly always right, which is why the consensus
claim above remains untested. The one false positive across all six rounds was
produced by **both** lenses at once — both had to resolve a single opaque helper and
both inferred its behaviour from its name. Independence of *method* does not give
independence of *failure*.

## What's here

```
foreman.md              the dispatch / verify / merge / report method
lenses/
  architect.md          structure, data shape, reversibility
  check.md              correctness — boundaries, absent values, error paths
  security-check.md     OWASP-framed application security
  taint.md              sink-first data flow to a dangerous operation
  ux.md                 usability under interruption and extreme states
lib/
  parse.mjs             lens text -> findings
  merge.mjs             normalize, dedupe, consensus scoring
  sarif.mjs             SARIF 2.1.0 writer
  baseline.mjs          baseline record / filter / staleness
  lenses.mjs            frontmatter, glob routing, roster validation
  calibrate.mjs         score a run against planted defects
  corpus.mjs            external corpora, case-level scoring
lib/
  prompt.mjs            lens prompt construction
  run.mjs               roster planning and bounded fan-out
  config.mjs            .crosscheckrc.json discovery and validation
bin/crosscheck.mjs      CLI: run | lenses | report | sarif | baseline |
                             overlap | calibrate
fixtures/calibration/   planted defects, ground truth, and the calibration record
fixtures/deception/     20 modules that look safe and are not, or the reverse
PROVENANCE.md           where all of this came from
```

Every lens shares one output contract, so the merge needs no per-lens parsing:

```
file:line — SEVERITY — issue — fix
```

`SEVERITY` is `BLOCK`, `FIX`, or `CONSIDER`; other vocabularies normalize onto it. A
lens with nothing to say returns exactly `NO FINDINGS` — deliberately distinct from
a lens that failed to run. Lines that do not match the contract are reported as
unparsed rather than discarded, because a lens that starts narrating instead of
reporting should not look like a clean one.

Routing is declared in each lens's frontmatter (`when`, `owns`, `not-owns`), so a
roster validates before any agent is dispatched. `not-owns` is required: a lens that
never declines dilutes the signal everything else depends on.

> **Note:** `fixtures/deception/src/` contains deliberately exploitable code and
> helpers that behave differently from what their names promise. It exists to test
> reviewers. Do not copy any of it into real software.

## Using it

The lenses are plain markdown prompts — nothing is tied to a particular agent
framework. Any harness that can run N prompts concurrently and collect their text
can drive this; feed the results in as `[{"lens": "check", "output": "..."}]`, with
`null` for a lens that died.

`crosscheck run` does this for you, bounded by `--concurrency`, and writes the raw
lens text with `--out` so a run can be rescored later without paying the model
again. Routing comes from each lens's `when` globs; `--only` and `--skip` override
it, and every skip is reported with its reason.

One property worth preserving if you build your own dispatcher: **dispatch out of
band.** A parallel fan-out that renders inline floods the session you are working
in and has to be killed to recover it.

```bash
npm test   # 183 tests, no dependencies
```

## Adding your own lenses

Lens sources layer, in increasing precedence:

1. the lenses packaged with crosscheck
2. `./lenses` or `./.crosscheck/lenses` in your project, if present
3. anything named by `--lenses dir,dir` or the config's `lenses` key

A later source **adds** to the earlier ones. A lens whose `name` matches an
earlier one **overrides** it, and the override is printed — so customising the
stock `check` costs one file rather than forking all five and losing upstream
changes. `--no-builtin` drops the packaged set entirely.

```bash
mkdir -p .crosscheck/lenses
$EDITOR .crosscheck/lenses/chaos.md
npx @applesnort/crosscheck lenses     # what resolved, and from where
```

A lens is a markdown file: five frontmatter keys, then the prompt.

```markdown
---
name: chaos
summary: adversarial user trying to break the flow
when: [**/*.{js,jsx,tsx,vue}]
owns: states reachable by misuse — double-submit, back button, hostile input
not-owns: correctness, security categories, architecture
---

# Lens: chaos

You are trying to break this, not review it. ...

Findings only: `file:line — SEVERITY — issue — fix`. SEVERITY is BLOCK, FIX, or
CONSIDER. If nothing here can be broken, reply exactly `NO FINDINGS`.
```

`when` routes it — a lens whose globs match nothing in the target is skipped, with
the reason printed. `not-owns` is required: a lens that never declines dilutes the
signal everything else depends on. The body should end by restating the output
contract, since that is what the parser expects back.

`crosscheck lenses` prints the resolved set with each lens's origin and globs,
which is the fastest way to see why something did or did not run.

## Writing a good lens

A lens earns its place by finding what the others miss. Give it a remit narrow
enough that it declines most changes, state what it does *not* own, and make it name
the concrete trigger for every finding. Then measure it: add defects it should catch
to the calibration fixture and check whether recall actually moved, and check the
overlap figure to see whether it is telling you anything the existing lenses were
not.

If a lens encodes your product's domain, your storage conventions, or a particular
reviewer's standards, keep it in your own project. The ones here are deliberately
generic; the useful ones usually aren't.

## Prior art

Multiple critic personas reviewing code is not a new idea and is not claimed as one.
Claude Code ships a parallel multi-agent code review; community multi-agent review
panels exist; aggregating several analyzers and weighting their agreement is
long-standing practice, formalized in SARIF.

What is offered here is narrower: LLM review lenses as a **SARIF producer**, with
lens redundancy measured rather than assumed, and a calibration harness that reports
what it cannot establish as readily as what it can. See
[`PROVENANCE.md`](PROVENANCE.md).

## License

MIT — see [`LICENSE`](LICENSE).
