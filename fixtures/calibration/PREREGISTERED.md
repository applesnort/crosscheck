# Pre-registered evaluation criteria

Written **before** the runs it governs, and committed separately, so the standard
cannot be adjusted after seeing the numbers. The claim being tested is the one
this project leads with, so it is the one most worth protecting from its author.

## The claim under test

> A finding that several independent lenses reported is more likely to be real
> than one a single lens reported.

Everything in this repository's ranking depends on that. If it is false, the
consensus score is decoration and the honest move is to remove it from the
headline and keep only the deduplication.

## Why earlier runs could not test it

Two runs against this fixture produced **zero false positives** across 16
findings. With single-lens precision already at 100%, consensus had nothing to
discriminate — the comparison was undefined, not favourable. Reporting that as
support would have been dishonest, so the README recorded it as unproven.

A test of "consensus filters mistakes" requires a run that contains mistakes.

## Method

Two configurations against the same fixture and the same ground truth, differing
only in the model tier driving the lenses:

1. **Capable tier** — the baseline already measured.
2. **Weaker tier** — cheaper lenses make more errors, which is the point. This
   generates the false positives the claim needs in order to be falsifiable.

The prompts, lens definitions, fixture, and ground truth are identical across
configurations. Only the model changes.

## Falsification criteria — fixed in advance

Given a run with **at least 3 false positives** (below that, the comparison is
too thin to mean anything and the result is reported as inconclusive):

- **Claim supported** if consensus precision exceeds solo precision by at least
  10 percentage points.
- **Claim refuted** if consensus precision is at or below solo precision. The
  consensus score is then removed from the README's headline claims and demoted
  to an implementation detail, and this file records the refutation.
- **Inconclusive** for anything between. Reported as inconclusive, not as
  partial support.

## Rules that make the above mean something

- **Every run is reported**, including runs that go against the claim. No run is
  discarded for being unflattering, and the count of runs performed is stated.
- **The fixture is frozen** for the duration of these runs. No decoy is made
  subtler and no defect is reworded after seeing which ones the lenses bit.
- **One fixture change is permitted before the runs begin**, and it is declared
  here rather than discovered later: `getSessionForUser` accepted no caller
  identity, so its planted authorization gap had nothing in scope to check
  against, and both prior runs were scored down for declining to report it. The
  function now accepts a caller identity and ignores it, which makes the defect
  unambiguous. This corrects a flaw in the experiment, and it is expected to
  *raise* recall — which is exactly why it is declared before the run rather
  than after.
- **No threshold tuning against these runs.** The similarity threshold and line
  tolerance were fixed by earlier measurement and stay fixed here. If they later
  need re-measuring, that is a separate exercise with its own record.

---

# Outcome — recorded 2026-08-05

Two configurations run, three lenses each, identical prompts and fixture. Both
runs are reported, as required.

| | capable tier | weaker tier |
|---|---|---|
| recall | 100% (7/7) | 100% (7/7) |
| findings | 8 | 9 |
| false positives | **0** | **0** |
| consensus precision | 100% | 100% |
| solo precision | 100% | 100% |
| consensus findings | 4 | 2 |

## Verdict: INCONCLUSIVE

The criteria required at least 3 false positives for the comparison to mean
anything. Both runs produced **zero**, so consensus precision and solo precision
are both 100% and the comparison is undefined for a third time. The claim is
neither supported nor refuted. Per the rules above this is recorded as
inconclusive, not as partial support, and the consensus score stays in the code
without a validation claim attached to it in the README.

## Why the method failed to test the claim

The premise was that a weaker model tier would make more mistakes, supplying the
false positives the comparison needs. It did not. The weaker tier was **terser,
not wronger** — it reported fewer findings per lens, in shorter sentences, and
every one of them still landed on a real planted defect. Lower capability showed
up as reduced coverage and cruder severity judgement, not as invention. That is
worth knowing on its own, and it means model tier is the wrong knob for
generating false positives.

## What the declared fixture change did

`getSessionForUser` now accepts a caller identity and ignores it. Recall went
from 71-86% to **100% at both tiers**, and all six lens runs found the
authorization gap. This confirms the earlier miss was a flaw in the fixture, not
a gap in the lenses: with no caller identity in scope there was genuinely nothing
to check against. Declared in advance precisely because it was expected to
flatter the numbers.

## What would actually test the claim

Not another tier, and not subtler decoys authored by the same person who wrote the
ground truth — that is the p-hacking route this file exists to block. It needs a
target where the lenses genuinely err: real production code with independent
ground truth, or a defect corpus someone else built. Until such a run exists, the
consensus weighting remains an unvalidated hypothesis, and the README says so.

---

# Round 2 — external corpus. Criteria fixed 2026-08-05, before any run.

The first three rounds could not test the claim because the lenses never erred,
and every decoy was written by the same person who wrote the ground truth, the
lens prompts, and the scorer. That circularity is the flaw. This round removes it
by using a corpus authored by someone else.

## Corpus

[OWASP Benchmark](https://owasp.org/www-project-benchmark/) v1.2 — 2,740
self-contained Java servlets, each carrying one intentional CWE and a label in
`expectedresults-1.2.csv`:

- **1,415 labeled `true`** — the vulnerability is real.
- **1,325 labeled `false`** — the code follows the same taint path into a *safe*
  sink. It looks vulnerable and is not.

Those 1,325 are the point. They are externally authored false-positive
opportunities, which is exactly what three rounds of hand-made decoys failed to
produce.

The corpus is not vendored into this repository. `licenseInfo` reports null on the
upstream repo, so no assumption is made about redistribution terms: a fetch
script clones it locally, it is gitignored, and only the adapter, the sample
manifest, and the resulting scores are committed.

## Sampling rule — fixed here, applied mechanically

For each of the 11 categories, take the **first 3 `true` and first 3 `false`
cases by ascending test number**. Up to 66 cases, balanced by construction and
reproducible by anyone. Where a category holds fewer than 3 of a label, take what
exists and state the shortfall.

No hand-picking, and no re-drawing the sample after seeing results. The manifest
is committed before the run.

## Scoring

Benchmark labels a whole test case, not a line, so line-span matching does not
apply. A finding **matches** a case when it cites the case's CWE number or its
category vocabulary. Then:

- label `true` + match → true positive
- label `true` + no match → missed
- label `false` + match → **false positive**
- label `false` + no match → correctly declined

Only findings matching the expected CWE count either way. A lens reporting some
unrelated real issue in a `false` case is neither credited nor penalised, and the
count of those is reported separately.

## Falsification criteria

Given at least 3 false positives — which this corpus should finally supply:

- **Claim supported** if consensus precision exceeds solo precision by ≥10
  percentage points.
- **Claim refuted** if consensus precision is at or below solo precision. The
  consensus score is then removed from the README's headline and demoted to an
  implementation detail.
- **Inconclusive** otherwise, and reported as such.

Unchanged from round 1: every run reported, no threshold tuning against these
runs, no post-hoc sample changes.

## Declared threat to validity

OWASP Benchmark is synthetic, widely published, and almost certainly present in
model training data. Absolute recall may therefore be inflated by memorisation
and should not be quoted as evidence the lenses are good.

This does **not** undermine the measurement being made here. The question is
whether agreement between lenses predicts correctness — a comparison *within* the
run, between consensus and solo findings drawn from the same model on the same
corpus. Memorisation would have to affect consensus and solo findings
differentially to bias that, which there is no reason to expect. Stated here so
it cannot be raised later as though it were concealed.

## Round 2 addendum — a second security-capable lens, declared before running

Building the adapter surfaced a flaw in the experiment. OWASP Benchmark is
entirely security cases, and in this roster only `security-check` owns security —
`check` and `architect` both name "security categories" in their `not-owns`. So no
finding on this corpus could ever be reported by two lenses, and consensus could
never form. The corpus would measure false-positive rate well and leave the
consensus claim exactly as untestable as before.

Testing agreement requires at least two competent, independent observers in the
domain under test. A single-domain corpus therefore needs a second
security-capable lens. Adding one is a requirement of the measurement, not a
thumb on the scale — but it is declared here, before the run, with the
constraints that keep it honest:

- **Written without looking at any corpus case.** The lens is authored from the
  method alone. No Benchmark file is read while writing it.
- **A genuinely different method, not a paraphrase.** `security-check` works from
  OWASP categories and CWE checklists — a taxonomy walk. The new `taint` lens
  works sink-first: enumerate the dangerous operations, trace each argument back
  toward its origin, and ask whether anything sanitises it in between. Same
  domain, different reasoning path. That is precisely the "two lenses that
  overlap in domain but not in method" case the independence weighting exists to
  score.
- **No tuning toward agreement.** The lens is not adjusted after any run, and its
  overlap with `security-check` is measured, not assumed.

If the two lenses turn out to be highly redundant, the independence weighting
should *discount* their agreement — and that outcome is as interesting as the
alternative. It is reported either way.

---

# Round 2 outcome — recorded 2026-08-05

66 OWASP Benchmark cases, 33 vulnerable and 33 safe, two lenses
(`security-check`, `taint`), three batches each. All six agents completed. Zero
unparsed lines, zero unmapped findings.

| | |
|---|---|
| recall | **97.0%** (32/33) |
| specificity | **97.0%** (32/33) |
| false positives | **1** |
| unrelated findings | 3 (neither credited nor penalised) |
| consensus detections | 15, precision **93.3%** |
| solo detections | 18, precision **100.0%** |
| measured lens overlap | 0.4545 |

## Verdict: INCONCLUSIVE

The criteria require at least 3 false positives. This run produced **1**, so the
comparison is inconclusive and the claim is neither supported nor refuted.

Consensus precision came out *below* solo precision, 93.3% against 100%. That is
directionally against the claim, and it is tempting to call it a refutation — the
criteria deliberately forbid that. One false positive cannot separate a real
effect from noise, and a rule that only binds when the result is unwelcome is not
a rule. Recorded as inconclusive.

## The single false positive is the most informative result here

`BenchmarkTest00052`, a safe `sqli` case, was flagged by **both** lenses.

The case builds `"{call " + param + "}"` and executes it, which is the vulnerable
idiom exactly. But `param` comes from
`SeparateClassRequest.getTheValue("BenchmarkTest00052")`, and that helper
**returns the constant `"bar"`**, ignoring its argument. The value is never
attacker-controlled and the SQL is not injectable.

Both lenses inferred taint from the helper's *name*. The class is called
`SeparateClassRequest`, it is constructed from the request, and its sibling
methods (`getTheParameter`, `getTheCookie`) really are request accessors. Neither
lens opened the helper.

Two consequences worth more than the headline numbers:

**Independence of method did not produce independence of failure.** The lenses
reason differently — one walks CWE categories, the other traces sinks backward —
and the overlap measurement confirms they are only ~45% redundant. They still
failed identically, because both had to resolve the same opaque helper and both
guessed from its name. Consensus cannot filter an error whose *cause* is shared.
That is a real limit on what agreement-weighting can do, and it is invisible in
any evaluation where the lenses do not err.

**A caveat in the prompt does not prevent the behaviour it warns about.**
`lenses/taint.md` names this exact mistake twice — "a sink whose argument is
trusted" and "a sanitiser you did not recognise… the origin is `unknown`, and the
correct output is either silence or a `CONSIDER`". The lens described its own
failure mode and then committed it. Prompt-stated discipline is not enforcement.

## The one miss

`BenchmarkTest00098`, `trustbound`. Trust-boundary violations — untrusted data
written into a session attribute — have no dangerous sink to trace and no
recognisable category idiom, so neither lens's method reaches them.

## Threat to validity, restated

97% recall *and* 97% specificity on a public benchmark almost certainly reflects
some memorisation; the corpus is widely published and predates the models. Those
two figures should not be quoted as evidence the lenses are good.

The within-run consensus-versus-solo comparison is less exposed to that, but the
run failed to test it for a different reason: the lenses were nearly always
right, so there was almost nothing for consensus to discriminate. Three rounds of
self-authored fixtures and one round of external corpus have all failed the same
way. The obstacle is not fixture quality — it is that these lenses, on
benchmark-shaped code, do not make enough mistakes to measure a mistake filter.

Testing the claim needs targets where competent review genuinely errs: real
production code with independent ground truth, ambiguous cases with expert
disagreement, or a corpus built to defeat exactly the shortcut seen here — an
opaque helper whose behaviour contradicts its name. That last idea comes from
this run's single false positive, and building a fixture around it would be
legitimate only with new criteria fixed in advance.

---

# Round 3 — deception corpus. Criteria fixed 2026-08-05, before the corpus exists.

## The question changed, and this states why before any data is collected

Five rounds have failed to test "consensus predicts correctness" because the
lenses almost never erred. Round 2's single false positive showed why that
framing is the wrong one: two lenses with genuinely different methods
(~45% measured overlap) failed **identically** on `BenchmarkTest00052`, because
both had to resolve one opaque helper and both guessed from its name.

Consensus can only filter errors that are *uncorrelated between lenses*. So
whether it helps is not a property of consensus — it is a property of the error
structure of a given roster on a given codebase. A corpus of traps therefore
cannot answer "does consensus work", because whoever picks the ratio of shared to
method-specific traps picks the answer.

The testable question is: **does consensus filter method-specific errors while
failing on shared ones, in the direction and rough magnitude predicted?** If yes,
the tool's job is to measure that ratio for your roster, and consensus weighting
is worth having exactly when your failures are uncorrelated. If no — if consensus
fails to filter even method-specific errors — the weighting is worthless and
comes out.

## Corpus design — the mix is declared here and not changed afterward

20 cases, one defect-or-not per file, written for this experiment. Lenses
(`security-check`, `taint`) are **frozen**: not edited before, during, or after.

| class | n | what it is | correct answer |
|---|---|---|---|
| `vulnerable` | 5 | plainly exploitable, no tricks | flag it |
| `clean` | 5 | plainly safe, no tricks | say nothing |
| `trap-category` | 3 | matches a known-bad *idiom*, but the value is provably constant or the use is non-security | say nothing |
| `trap-flow` | 3 | value genuinely untrusted, but the sink is inert or a real sanitiser intervenes | say nothing |
| `trap-shared` | 4 | a helper whose behaviour contradicts its name — two safe, two genuinely exploitable | 2 say nothing, 2 flag it |

`trap-category` should fool a taxonomy walk and not a flow trace.
`trap-flow` should fool a flow trace and not a taxonomy walk.
`trap-shared` should fool both, in both directions: two produce shared false
positives, two produce shared *misses*. Including shared misses matters — a
corpus containing only false-positive bait would engineer consensus to look bad.

## Predictions, recorded before running

1. Consensus precision **exceeds** solo precision, because `trap-category` and
   `trap-flow` errors should be solo by construction while only `trap-shared`
   produces agreement on a wrong answer.
2. At least 3 false positives total, satisfying the threshold that rounds 1-2 never
   reached.
3. Both `trap-shared` false-positive cases are flagged by **both** lenses.
4. Measured lens overlap stays well below 1.0, confirming the two remain
   distinguishable.

If prediction 1 fails while 2 holds, the claim is **refuted** and consensus
weighting is removed from the README headline. If 2 fails again, the corpus was
too easy and that is reported as another inconclusive round — not retried with
harder traps under the same criteria.

## What this round cannot show

It cannot establish that consensus helps on *real* code, because the trap mix is
chosen. It can establish the mechanism by which consensus helps or fails, and
whether the tool's own overlap measurement predicts which case you are in. That
is the claim the README will be allowed to make if the predictions hold — no
broader one.

---

# Round 3 outcome — recorded 2026-08-05

20 cases, two lenses, one batch each. Zero unparsed, zero unmapped.

| | |
|---|---|
| recall | **100%** (7/7) |
| specificity | **100%** (13/13) |
| false positives | **0** |
| consensus detections | 7, precision 100% |
| solo detections | **0** |
| measured lens overlap | **1.0** |

## All four predictions failed

1. Consensus exceeds solo precision — **untestable**: there were no solo
   detections at all.
2. At least 3 false positives — **failed**: zero.
3. Both `trap-shared` false-positive cases flagged by both lenses — **failed**:
   both were correctly declined.
4. Lens overlap stays below 1.0 — **failed**: it is exactly 1.0. The two lenses
   returned *identical* detection sets across all 20 cases.

Verdict: **INCONCLUSIVE**, round six. Per the criteria, a second failure of
prediction 2 means the corpus was too easy and is reported as such, not retried
with harder traps under the same rules.

## I compromised the shared traps myself

The dispatch prompt included this line:

> The modules import from `helpers/` and `db.js`. You may and should read those
> too — what a helper is named and what it does are separate questions.

That is a direct hint defeating the entire `trap-shared` class. Those four cases
exist to test whether a lens infers behaviour from a helper's name, and the prompt
told the lenses not to. The `trap-shared` results are therefore void: they measure
whether a coached reviewer opens a helper, which was never in doubt.

`trap-category` and `trap-flow` received no such hint and were still declined
perfectly — six for six. Those results stand, and they say the lenses do not bite
on idiom-matching or on inert sinks.

## What the overlap of 1.0 actually shows

This is the round's real result, and it is not about the consensus claim.

`security-check` and `taint` were written with deliberately different methods — a
CWE taxonomy walk versus sink-first flow tracing — and on OWASP Benchmark they
measured 0.4545 overlap, meaningfully independent. On this corpus they produced
*byte-for-byte equivalent* detection sets: same 7 files, same verdicts.

The independence weighting handled that correctly. At overlap 1.0 it scores their
agreement as **1.0 effective confirmations** — worth exactly one lens, because
that is what it is worth. The mechanism detected a redundant roster and refused to
inflate confidence for it.

So the weighting has now done useful work twice, on real data, in both directions:
0.45 on a corpus where the lenses differed, 1.0 on one where they did not. That
capability — *telling you whether your roster is redundant on your code* — is
measured and defensible. It is not the same as the claim that consensus predicts
correctness, which remains unproven.

## Round 4: repeat without the hint

The one experiment this round should have run. Same 20 cases, same frozen lenses,
same criteria — with the helper-reading sentence removed from the dispatch prompt.
This corrects my methodological error rather than making the corpus harder, and
that distinction is why it is permitted under the rules above.

Prediction, recorded now: **both `ts01` and `ts02` are flagged by both lenses**,
reproducing round 2's `BenchmarkTest00052` failure and finally supplying shared
false positives. If they are declined again, these lenses do not commit the
name-inference error unprompted, round 2's single false positive was a fluke, and
the claim is abandoned as untestable by any means available here.

---

# Round 4 outcome — recorded 2026-08-05. Last round on this question.

Identical corpus, identical frozen lenses, one sentence removed from the dispatch
prompt. Result identical to round 3: **20/20**, recall 100%, specificity 100%,
zero false positives, zero solo detections, overlap 1.0. Both lenses again
returned the same seven files.

**The prediction failed.** `ts01` and `ts02` were declined again. Without any
prompting, both lenses opened `helpers/requestValues.js`, saw that `getUserInput`
and `readParam` return constants, and said nothing. The hint I removed was not
what saved them in round 3 — they simply do not commit the name-inference error
here.

## Conclusion: the claim is abandoned as untestable by available means

Six rounds. Two self-authored fixtures, one external corpus of 2,740 cases, two
model tiers, a purpose-built deception corpus, and a controlled prompt ablation.
Total false positives observed across all of it: **one**.

The obstacle was never fixture quality. It is that these lenses, on small
self-contained modules with visible imports, are close to perfect — and an error
filter cannot be measured on a process that does not err. Benchmark-shaped code is
where LLM review is *strongest*, which makes it precisely the wrong place to
measure this.

Round 2's single false positive is worth one more note. It occurred at 22 unfamiliar
Java files per agent, with the deceptive helper several imports deep in a large
repository. Rounds 3 and 4 gave 20 small modules with direct imports and produced
nothing. That suggests the error rate is driven by context load and unfamiliarity
rather than by the trap itself — which is consistent with needing real production
code to observe, and is exactly what cannot be assembled with reliable ground
truth here.

The claim is therefore **not refuted** — the pre-registered refutation condition
(consensus precision at or below solo, given at least three false positives) never
triggered. It is unfalsifiable with the means available, and an unfalsifiable
claim does not get to be a headline. The consensus score stays in the code and in
the report, documented as an unvalidated hypothesis.

## What *is* established, and becomes the headline instead

The independence measurement works and has produced meaningful, discriminating
results on real data in both directions:

- **0.4545** on OWASP Benchmark — two lenses with genuinely different methods,
  meaningfully independent.
- **1.0** on the deception corpus — the same two lenses, byte-for-byte identical
  detection sets, and the weighting correctly scored their agreement as worth
  exactly one lens rather than two.

A tool that tells you *your roster is redundant on your code* is answering a
question you can act on: drop a lens, or replace it with one that fails
differently. That is measured, reproducible, and does not depend on the
unvalidated claim.

No further rounds on this question. Reopening it requires a corpus of real
production code with independently authored ground truth, and new criteria fixed
in advance.
