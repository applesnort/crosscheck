# Example lenses

The five lenses in `lenses/` are general — architecture, correctness, security,
taint, usability. They ship with crosscheck because every codebase has those
concerns, and they are deliberately written to know nothing about yours.

That makes them a poor demonstration of what a lens is actually for.

The three files here are the opposite: real lenses from a production Shopify app,
each one written because something specific went wrong. They are here to be read,
not run.

## They are not loaded

Lens discovery is not recursive. `loadLenses` reads `*.md` directly inside a lens
directory and does not descend into subdirectories, so nothing in `examples/`
joins the packaged roster. Copying a file up one level into `lenses/`, or into
your own `.crosscheck/lenses/`, is what makes it live.

You should not do that with these. Their `when:` globs name paths in someone
else's repository and will match nothing in yours.

## What to take from them

**A rule earns its place by naming the failure it prevents.** `metafield-hygiene`
opens by stating that breaking its first rule takes a storefront down, and that a
violation is therefore BLOCK rather than style. That sentence is doing the work —
a model weighing whether a finding is worth reporting needs to know the cost of
missing it.

**Point at your own code.** These lenses name `resolveFitmentDepth()`,
`CPF_METAFIELDS`, `provisionCpfSetup`. A lens that says "validate input properly"
produces generic findings. A lens that says "report any read of this field that
does not go through this resolver" produces findings a reviewer can act on
without rereading the file.

**Encode the invariant, not the symptom.** `fitment-depth` exists because one
codebase has two different things both called depth, and confusing them produces
a wrong answer that looks correct. No general-purpose lens can find that. It is
also the clearest case for domain lenses in general: the bugs that survive
review are usually the ones that require knowing what the code means, not what it
says.

**State what the lens declines.** All three set `not-owns` narrowly. A lens that
comments on everything dilutes consensus, which is why the field is required.

## Provenance

Written by [@cunningorb](https://github.com/cunningorb) for a commercial Shopify
app, and reproduced here with permission. Included verbatim — the specificity is
the point, and sanitising them would remove the thing worth showing. See
`PROVENANCE.md`.
