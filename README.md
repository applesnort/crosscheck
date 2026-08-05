# crosscheck

Run several independent review lenses over the same change in parallel, then merge
their findings into one deduped, consensus-ranked report — and emit it as
**SARIF**, so LLM review findings land in the same places static-analysis findings
already do.

```bash
# your harness dispatches the lenses and collects their text; this does the rest
crosscheck report --in run.json
crosscheck sarif  --in run.json --lenses lenses --out panel.sarif
```

The panel is a foreman, not a reviewer. It resolves the target, decides which
lenses are relevant, dispatches them, and synthesizes what comes back. The lenses
do the looking. The deterministic half — parse, dedupe, score, emit — is code with
tests, not prompt instructions.

## Why lenses instead of one review pass

A single review pass optimizes for one kind of defect at a time. Ask for
"problems" and you get whichever category the model reaches for first. Ask five
narrow specialists — each told to ignore everything outside its remit — and the
union covers more ground, because none of them is trading correctness findings
against usability findings inside one context.

Agreement then becomes signal. Two lenses that never saw each other's output,
landing on the same `file:line`, is a stronger claim than either alone.

## Consensus is weighted by independence, not headcount

Most implementations stop at "N agents agreed." That over-credits lenses whose
remits overlap: `check` and `security-check` both look at injection, so their
agreement says less than `architect` and `ux` converging on the same line.

A finding is scored as **effective independent confirmations** — 1 for a single
lens, and for a set, 1 plus the summed independence of every distinct pair, where
independence is `1 − overlap` measured from a real run:

```bash
crosscheck overlap --in run.json --out overlap.json   # measure it
crosscheck report  --in run.json --overlap overlap.json
```

Two unrelated lenses agreeing scores `2.0`. Two fully redundant ones score `1.0` —
the same as one lens alone, which is what their agreement is actually worth. Pairs
with no measured overlap are treated as independent, and that assumption is stated
rather than hidden.

### Matching is fuzzy, because real lens output is

Two lenses never phrase a defect the same way, and they anchor it on different
lines. In one measured run, three lenses each found the same swallowed error and
cited it at lines **54, 56, and 57**. An exact-match merge reports that as three
findings and zero agreement.

So findings cluster on line proximity (±3 lines) **plus** issue similarity — a
Jaccard index over content words, thresholded at `0.12`. Both defaults come from
measurement, not intuition. Across two runs, pairs describing the same defect
scored `0.161 / 0.210 / 0.300 / 0.538`; pairs describing *different* defects that
happened to share a line scored `0.038 / 0.050` — a timing side channel versus a
nullish comparison on one expression, an unenforced expiry guard versus a split
store contract on another. The threshold sits in the gap.

The margin is thinner above than below, so under-merging is the failure mode to
expect first, and six pairs is a small sample. `test/merge-realdata.test.mjs`
pins both bands using verbatim lens output, so the thresholds cannot drift
unnoticed. Re-measure when the roster or the lens prompts change.

**What is and is not established.** The mechanism fires on real output, and
distinct same-line defects are correctly kept apart. Whether consensus *predicts
correctness* is **unvalidated after five rounds**, including one against an
external corpus of 66 [OWASP Benchmark](https://owasp.org/www-project-benchmark/)
cases — 33 of them safe code written by someone else to bait tools.

Every round has failed to test the claim the same way: the lenses are almost
always right, so there is nearly nothing for consensus to discriminate. On the
corpus run, recall and specificity were both 97% and there was exactly **one**
false positive — below the pre-registered threshold of three.

That one false positive is the most useful thing measured so far, and it cuts
against the mechanism. **Both** lenses flagged a safe case: it builds
`"{call " + param + "}"` and executes it, but `param` comes from a helper named
`SeparateClassRequest` whose `getTheValue` returns the constant `"bar"` and
ignores its argument. Neither lens opened the helper; both inferred taint from the
name.

So independence of *method* does not give independence of *failure*. The two
lenses reason differently and measure only ~45% redundant, yet they failed
identically, because both had to resolve the same opaque helper. **Consensus
cannot filter an error whose cause is shared** — a real limit on agreement
weighting, and one invisible in any evaluation where the lenses do not err.

Worth noting too: `lenses/taint.md` warns against that exact mistake twice, and
committed it anyway. A caveat in a prompt is not enforcement.

Criteria were fixed before each round and every outcome is recorded in
[`fixtures/calibration/PREREGISTERED.md`](fixtures/calibration/PREREGISTERED.md),
including the rounds that failed to test anything.

## SARIF output

Findings are emitted as [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html),
the OASIS interchange format static analyzers already speak. That puts lens output
into GitHub code scanning, editor problem panels, and security dashboards without
any of them knowing a model produced it.

- One **rule per lens**, carrying the standards that lens cites, so consumers can
  filter and configure by lens.
- `partialFingerprints` for stable identity across runs, independent of severity,
  fix text, and ordering.
- Consensus rides in `properties` (`lenses`, `consensus`, `consensusScore`), since
  SARIF has no native concept for it.
- A lens that died sets `executionSuccessful: false` and emits a
  `toolExecutionNotification`. The gap is machine-readable, not a line of prose a
  dashboard will drop.

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

## Calibration — is the panel actually working?

A persona panel is otherwise unfalsifiable: you cannot tell whether it works,
whether a new lens helped, or whether a prompt edit made it worse. `fixtures/calibration/`
holds a file with defects planted at known lines, and:

```bash
crosscheck calibrate --in run.json --expected fixtures/calibration/expected.json
```

reports recall, precision, per-lens recall against only the defects that lens
owns, severity agreement, and — the number that matters — **consensus precision
beside single-lens precision**:

```
consensus vs solo precision — if these are equal, consensus ranking is
decoration and should be dropped or reweighted:
  consensus (3): 100.0%
  solo      (6): 100.0%
```

That comparison is the whole ranking's justification, and it is measured rather
than asserted. Equal precisions mean "not yet shown," not "confirmed" — a run
where the lenses make no mistakes cannot demonstrate that consensus filters
mistakes. It exits non-zero when a planted defect was missed, so it works as a CI
gate on the panel itself.

Measured results. Rounds 1-4 use the built-in fixture (7 planted defects, 7
decoys); round 5 uses 66 OWASP Benchmark cases (33 vulnerable, 33 safe):

| | fixture x4 | OWASP Benchmark |
|---|---|---|
| recall | 71-100% | **97%** (32/33) |
| specificity | n/a (no safe cases) | **97%** (32/33) |
| false positives | 0, every run | **1** |
| consensus precision | undefined (no errors) | 93.3% (15) |
| solo precision | undefined (no errors) | 100.0% (18) |
| verdict | inconclusive | inconclusive |

Both precisions being equal or undefined means "not shown", never "confirmed".
The corpus run's single false positive was a *consensus* one, which is
directionally against the claim — but one error cannot separate an effect from
noise, and the pre-registered criteria forbid reading a refutation into it. Read
`PREREGISTERED.md` for why that restraint matters more than the result.

Two caveats on the 97% figures: OWASP Benchmark is public and predates the
models, so memorisation is likely, and the lens prompts told the agents that
about half the files were safe. Neither figure is evidence the lenses are good.
Severity is under-called far more often than over-called, in every round.

## What's here

```
foreman.md              the dispatch / verify / merge / report method
lenses/
  architect.md          structure, data shape, reversibility
  check.md              correctness — boundaries, absent values, error paths
  security-check.md     OWASP-framed application security
  ux.md                 usability under interruption and extreme states
lib/
  parse.mjs             lens text -> findings
  merge.mjs             normalize, dedupe, consensus scoring
  sarif.mjs             SARIF 2.1.0 writer
  baseline.mjs          baseline record / filter / staleness
  lenses.mjs            frontmatter, glob routing, roster validation
  calibrate.mjs         score a run against planted defects
bin/crosscheck.mjs     CLI: report | sarif | baseline | overlap | calibrate
fixtures/calibration/   planted defects + ground truth
PROVENANCE.md           where all of this came from
```

Every lens shares one output contract, so the merge needs no per-lens parsing:

```
file:line — SEVERITY — issue — fix
```

`SEVERITY` is `BLOCK`, `FIX`, or `CONSIDER`; other vocabularies are normalized onto
it. A lens with nothing to say returns exactly `NO FINDINGS` — which is
deliberately distinct from a lens that failed to run. Lines that do not match the
contract are reported as unparsed rather than discarded, because a lens that
started narrating instead of reporting should not look like a clean one.

Routing is declared in each lens's frontmatter (`when`, `owns`, `not-owns`), so a
roster can be validated before any agent is dispatched. `not-owns` is required: a
lens that never declines dilutes the consensus signal everything else depends on.

## Using it

The lenses are plain markdown prompts — nothing is tied to a particular agent
framework. Any harness that can run N prompts concurrently and collect their text
can drive this; feed the results in as `[{"lens": "check", "output": "..."}]`, with
`null` for a lens that died.

Read `foreman.md` for routing, verification, and reporting. Two properties are
worth preserving whatever you build on:

**Dispatch out of band.** A parallel fan-out that renders inline floods the session
you are working in and has to be killed to recover it.

**Disclose every omission.** A lens skipped for irrelevance, a lens whose agent
died, and a finding refuted during verification are three different things and must
read differently. A partial panel presented as a complete one is worse than no
panel.

```bash
npm test   # 88 tests, no dependencies
```

## Adding a lens

A lens earns its place by finding what the others miss. Give it a remit narrow
enough that it declines most changes, state what it does *not* own, and make it
name the concrete trigger for every finding. Then measure it: add defects it should
catch to the calibration fixture and check whether overall recall actually moved.
A lens that only re-reports what another already found makes the panel slower and
its consensus signal weaker.

If a lens encodes your product's domain, your storage conventions, or a particular
reviewer's standards, keep it in your own project. The ones here are deliberately
generic; the useful ones usually aren't.

## Prior art

Multiple critic personas reviewing code is not a new idea and is not claimed as
one. Claude Code ships a parallel multi-agent code review; community multi-agent
review panels exist; aggregating several analyzers and weighting their agreement is
long-standing practice, formalized in SARIF.

What is offered here is narrower and, as far as I know, unoccupied: LLM review
lenses as a **SARIF producer**, with consensus weighted by measured lens
independence and a calibration harness that can show whether any of it helps. See
`PROVENANCE.md`.

## License

MIT — see `LICENSE`.
