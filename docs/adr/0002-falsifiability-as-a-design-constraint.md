# 2. Falsifiability as a design constraint

## Status

Accepted

## Context

crosscheck reports what a panel of lenses claims about code. Every output it
produces is an empirical claim, and until now they were not held to a consistent
standard of what makes a claim worth reporting.

Popper's demarcation is the one that fits: a claim earns its place by forbidding
something observable. A claim compatible with every possible state of the file
tells a reader nothing, no matter how confidently it is stated. Three outputs in
this tool failed that test.

**`NO FINDINGS` forbids nothing.** It is compatible with a file that is clean, a
file whose defects the lens could not recognise, and a lens whose questions
exceed the runner it was given. Measured: `gemma4:8b` returned `NO FINDINGS` on
all four lenses against a fixture with seven planted defects, three of them
`BLOCK`, and the panel verdict read `Ship`. Nothing in that output could have
been wrong, which is precisely the problem — it made no claim.

**An absent test read as a negative result.** A verifier that exited non-zero
left its finding standing and reported the failure. The same verifier exiting
zero with unparseable output removed the finding as refuted. Same absence of
evidence, opposite outcomes, and the destructive one was silent.

**Consensus counted voices rather than tests.** A finding reported by three
lenses ranked above one reported by a single lens. That is confirmation
counting, and it is only evidence if each of those lenses could have refuted the
finding and did not. A lens that abstained did not agree; it did not test.

## Decision

Four rules, applied wherever crosscheck emits or consumes a claim.

**1. An abstention must forbid something.** A lens declining to report states
what it examined: the sites it enumerated and the property it checked. That
converts "nothing here" into a claim a reader can check against the file and
find wrong. A bare `NO FINDINGS` remains accepted — breaking every existing lens
would be worse — but it is recorded as an *unsupported* abstention and reported
as distinct from one backed by coverage.

**2. A test that did not run produces no evidence in either direction.** A
finding is refuted only by a verdict that refutes it. A verifier that produced
nothing usable leaves the finding standing and untested, and untested is
reported separately from corroborated.

**3. Corroboration is never verification.** A finding that survived a refutation
attempt is reported as having survived one, never as confirmed, proven, or
validated. The wording is load-bearing: a reader who treats corroboration as
proof will stop checking.

**4. Consensus counts tests, not voices.** A lens contributes to a consensus
score only if it reported on the file in question. Abstaining and silent lenses
are excluded from the denominator and the fact is disclosed, because a score
computed over lenses that never looked measures roster size, not agreement.

And one rule for lens authors, which is where the leverage is:

**5. Prefer a check that can fail mechanically over a judgement that cannot.** A
lens may declare `invariants`, each pairing an observation rule with a verdict
rule. The observation rule names sites and is checkable against the file; the
verdict rule says what makes an observed site a defect. This is what lets a lens
lower its own capability floor: measured on the calibration fixture, the same
model found 0 of 3 `security-check` defects when asked to recognise vulnerability
classes and 2 of 3 when asked to enumerate sites and apply a stated rule.

## Consequences

**If this is right.** Silence stops being indistinguishable from diligence. A
cheap runner becomes safe to use, because a panel that cannot see reports that
it cannot see rather than reporting a pass. Consensus means what the README
claims it means. And a lens author gains a lever on the floor rather than only a
warning about it.

**If this is wrong.** Structured abstention costs output tokens on every lens
that finds nothing, which is most lenses on most files — the common case pays
for the rare one. Invariants risk becoming a checklist that crowds out the
judgement a capable model would otherwise apply, trading depth for reliability.
Neither is hypothetical; both need measuring against the calibration fixture
before the defaults harden.

**Costs of being right.** More output surface to parse and more report lines to
read. A report that distinguishes refuted, untested, corroborated, abstained
with coverage, and abstained without it is harder to skim than one that says
Ship.

**What this does not fix.** Rule 5 lowers a floor; it does not detect one.
crosscheck still cannot tell a competent abstention from an incompetent one on
its own evidence — it can only require that the abstention make a checkable
claim and report when it does not. Detecting capability needs a positive control
or recorded calibration provenance per lens-and-runner pair, and neither is in
this decision.

**A tension worth naming.** Rule 5 pushes lenses toward mechanical checks; a bolder
conjecture forbids more and is therefore more useful when it survives. Measured
here, loosening a lens's demand for concrete triggers cost 28.6 points of recall
and bought 3.8 points of precision — the demand for a concrete trigger is a
demand for content, not timidity, and removing it made the lens worse. The
resolution this tool adopts: conjecture with high content at the lens, refute
hard at the verifier. Not: conjecture cautiously everywhere.
