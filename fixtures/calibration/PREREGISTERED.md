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
