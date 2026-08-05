# Provenance

This file records where the content in this repository came from, so that anyone
reusing it can see what it derives from.

## The lens definitions

`lenses/architect.md`, `lenses/check.md`, `lenses/security-check.md`, and
`lenses/ux.md` were written from scratch on 2026-08-05.

They were composed from the stated purpose of each lens and from the named public
standards cited inside each file — OWASP Top 10 (2021) and ASVS for
`security-check`, Nielsen's ten usability heuristics for `ux`, and explicit
first-party criteria for `architect` and `check`. Citing a standard by identifier
is not reuse of its text; no text from any standard is reproduced here.

Earlier, personal versions of these four lenses existed in the author's local
tooling. Their origin could not be established from available records, so they were
deliberately **not** consulted while writing the versions in this repository, and
no text from them carries forward. That is the reason these files exist as a fresh
composition rather than as a cleanup of the originals.

## The foreman and the library

`foreman.md` describes the dispatch, verification, merge, and reporting method. It
originates with the author, developed through practical use across 2026. It is not
derived from a third-party source.

`lib/`, `bin/`, `test/`, and `fixtures/` were written from scratch on 2026-08-05
and have no third-party origin. They carry no dependencies, so nothing is
vendored, and no code was adapted from another project.

`lib/sarif.mjs` targets SARIF 2.1.0 as specified by OASIS. It implements the
format against the published specification; no text or code from the
specification is reproduced here. The two panel-specific additions —
`properties.consensusScore` and the `auditPanel/*` notification descriptors — are
this project's own, placed in the extension points the format provides for that
purpose.

The general idea of using multiple critic personas to review code is **not**
original to this project and is not claimed as such. Comparable prior work
includes Claude Code's built-in parallel code review, community multi-agent review
panels, and the long-standing static-analysis practice of aggregating several
tools and treating agreement between them as a confidence signal. What this
repository offers is a specific, documented method — not a novel concept.

## Deliberately not included

- **An accessibility lens.** The author's personal version derives from the
  GOV.UK accessibility personas (Ashleigh, Claudia, Ron), which are published by
  the Government Digital Service under the Open Government Licence v3.0. Reuse is
  permitted with attribution; rather than carry that obligation here, the lens is
  omitted. Anyone adding one should use the GOV.UK personas directly and attribute
  them under OGL v3.
- **Domain-specific lenses.** Lenses encoding a particular product's domain, or
  a particular named colleague's review preferences, are project-local by nature
  and are not published.
