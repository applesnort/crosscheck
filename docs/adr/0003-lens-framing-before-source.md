# 3. Lens framing before source

## Status

Accepted. Supersedes the prompt-ordering half of
[ADR 0001](0001-embed-source-in-lens-prompts.md); its decision to embed source
at all stands unchanged.

## Context

ADR 0001 put the source block first so that consecutive lenses routed to the
same files would share a byte-identical prefix, which is what a provider's
prefix cache requires. That decision recorded an inferred benefit — no cache
hit was ever observed — and named the risk it accepted as being about volume,
not about quality.

The quality cost turned out to be the larger one, and it is now measured.

A version-over-version benchmark run against the calibration fixture on one
fixed local model scored 0.9.0 **below** 0.8.0: recall 57.1% against 85.7%,
precision 45.5% against 58.3%. The regression was not spread evenly. Per lens:

| lens | 0.8.0 | 0.9.0 | declares invariants |
|---|---|---|---|
| security-check | reported nothing | 50% | yes |
| architect | 100% | 33.3% | no |
| check | 66.7% | 0.0% | no |

Two hypotheses were tested and one survived.

The first — that the `COVERAGE` requirement, placed last for salience, had made
stating coverage the task instead of finding defects — was tested by moving the
finding instruction back to the end. That improved `security-check` from 50% to
75% and left `check` and `architect` unchanged. Rejected as the cause, kept as
an improvement.

The second isolated source position directly: the same lens, the same model,
the same code, differing only in whether the source preceded or followed the
lens definition.

| source position | recall | precision | false positives |
|---|---|---|---|
| before the lens definition | **0.0%** | 0.0% | 3 |
| after the lens definition | **57.1%** | 80.0% | 1 |

A model given ten thousand tokens of code before being told which lens it is
has already read that code as nobody in particular. The framing has to arrive
first to be a frame at all.

## Decision

The lens's identity, definition and scope come first. The source it reviews
follows them. The source block is still rendered identically for a given file
set, and is still line-numbered and sorted — it is simply no longer first, and
therefore no longer a cacheable prefix.

Cross-lens prefix caching is given up. It was an inferred saving; this was a
measured loss, and trading a measured loss for an unmeasured saving is the wrong
direction regardless of the sizes involved.

Rejected: **keeping source first and repeating the lens framing after it.** It
preserves the prefix and costs the framing tokens twice per dispatch, on the
theory that the second copy does the work. Untested, and it treats a measured
attention effect as something that can be patched with repetition.

Rejected: **source first only for lenses that scored well that way.** Per-lens
prompt shapes would make every future benchmark result conditional on which
shape a lens happened to use, which is how a benchmark stops being comparable.

## Outcome — recorded 2026-09-05

Re-measured after the change, same fixture, same model, same scorer:

| version | recall | precision | defects found | false positives |
|---|---|---|---|---|
| 0.8.0 | 85.7% | 58.3% | 6/7 | 5 |
| 0.9.0 | **100%** | **61.5%** | **7/7** | 5 |

Per lens, 0.8.0 → 0.9.0: `check` 66.7% → 66.7% (recovered exactly),
`architect` 100% → 66.7%, `security-check` no findings at all → 50% recall at
100% precision. The overall gain comes from `security-check` covering defects
0.8.0 never reached, not from every lens improving.

`architect` remains below where it was and the aggregate improvement hides
that. It is recorded here rather than left for a later reader to rediscover:
one lens is still worse than it was before this release, and nothing in this
ADR explains why.

## Consequences

**What is kept.** Embedding source is what makes a bare model endpoint a usable
runner at all, and that is unaffected — it was never the ordering that did that
work. `--no-embed` still restores the pre-0.9.0 prompt.

**What is lost.** Every lens in a run now sends the source again at full price.
For a four-lens roster on one file that is four full-price reads where the ADR
0001 design hoped for one and three discounted ones. The token estimate reported
by `--budget` is unaffected — it always counted what was actually built.

**What this says about the earlier decision.** ADR 0001 was not wrong to embed.
It was wrong to optimise the arrangement for a benefit nobody had measured,
inside the same change that introduced embedding, so the two could not be
told apart until a benchmark separated them.

**Open question.** Whether a capable runner shows the same ordering sensitivity.
Everything above was measured on one small local model, chosen because it is
free and deterministic. It is plausible that a stronger model is indifferent to
ordering and the cache-friendly arrangement is safe for it — in which case
ordering becomes a property of the runner rather than of the tool, and the
right shape is one crosscheck cannot pick on its own.
