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
