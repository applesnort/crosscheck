# audit-panel

Run several independent review lenses over the same change in parallel, then merge
their findings into one deduped, severity-ranked report — where a defect two
lenses flagged independently outranks one only a single lens saw.

It is a foreman, not a reviewer. It resolves the target, decides which lenses are
relevant, dispatches them, and synthesizes what comes back. The lenses do the
looking.

## Why lenses instead of one review pass

A single review pass optimizes for one kind of defect at a time. Ask for
"problems" and you get whichever category the model reaches for first. Ask five
narrow specialists — each told to ignore everything outside its remit — and the
union covers more ground, because none of them is trading correctness findings
against usability findings inside one context.

Agreement then becomes signal. Two lenses that were never shown each other's
output, landing on the same `file:line`, is a stronger claim than either alone.
This is the same reasoning static-analysis triage has used for years when several
tools converge on one location; the difference here is that the "tools" are
prompted specialists rather than analyzers.

## What's here

```
foreman.md              the dispatch / merge / report method
lenses/
  architect.md          structure, data shape, reversibility
  check.md              correctness — boundaries, absent values, error paths
  security-check.md     OWASP-framed application security
  ux.md                 usability under interruption and extreme states
PROVENANCE.md           where all of this came from
```

Every lens shares one output contract, so the merge needs no per-lens parsing:

```
file:line — SEVERITY — issue — fix
```

`SEVERITY` is `BLOCK`, `FIX`, or `CONSIDER`. A lens with nothing to say returns
exactly `NO FINDINGS`.

## Using it

The lenses are plain markdown prompts — nothing here is tied to a particular
agent framework. Any harness that can run N prompts concurrently and collect their
text can drive this. Point each dispatched agent at one lens file, tell it to adopt
that lens completely, and give it the same target.

Read `foreman.md` for the routing, dedupe, and consensus rules. Two properties
are worth preserving whatever you build on:

**Dispatch out of band.** A parallel fan-out that renders inline floods the session
you are working in and has to be killed to recover it. Run the panel where its
progress is watchable separately.

**Disclose every omission.** A lens skipped for irrelevance, and a lens whose agent
died, are different things and must read differently in the report. A partial panel
presented as a complete one is worse than no panel — it reads as coverage that was
never there.

## Adding a lens

A lens earns its place by finding things the others miss. Give it a remit narrow
enough that it declines most changes, tell it explicitly what it does *not* own,
and make it name the concrete trigger for every finding. Lenses that report
preferences dilute the consensus signal — the whole mechanism depends on agreement
being informative.

If a lens encodes your product's domain, your storage conventions, or a
particular reviewer's standards, keep it in your own project. The lenses here are
deliberately generic; the interesting ones usually aren't.

## Prior art

Multiple critic personas reviewing code is not a new idea, and this project does
not claim it. Claude Code ships a parallel multi-agent code review; community
multi-agent review panels exist; aggregating several analyzers and weighting their
agreement is standard practice, formalized in SARIF. What is offered here is one
documented method with an explicit output contract — see `PROVENANCE.md`.

## License

MIT — see `LICENSE`.
