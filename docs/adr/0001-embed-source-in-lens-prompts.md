# 1. Embed source in lens prompts

## Status

Accepted

## Context

`--exec` names a command that receives a lens prompt on stdin and returns
findings on stdout. The prompt names the files to audit and instructs the
runner to read them:

```
Audit exactly these 1 file(s), reading each one completely before reporting on it:
  - fixtures/calibration/src/session.js
```

Three consequences follow from that, and all three are now load-bearing.

**The runner must be an agent.** Naming a file only works if the thing on the
other end can open it. A bare model endpoint — a local inference server, an API
call without tools — receives a request to review code it cannot see. Measured
directly: four lenses pointed at a bare `qwen2.5-coder:14b` returned
`NO FINDINGS` each, against a fixture with seven planted defects. The model was
not wrong; it had nothing to look at. This closes off every cheap runner, which
is precisely the tier a cost-sensitive panel needs most.

**The same source is paid for once per lens.** Five lenses auditing one file
means five agents each opening that file in a separate context, each paying
full input price. The panel's independence — the property the consensus claim
rests on — is bought by multiplying the input cost by the roster size.

**Nothing can be counted.** `README.md` states the constraint accurately: "The
unit is dispatches, not dollars. crosscheck cannot see tokens or cost — `--exec`
is an arbitrary command — so a monetary budget would be a number invented from
nothing." That is correct, and it is also why a user asked to justify the spend
has no numbers to bring. A budget cannot be enforced over a quantity the tool
never observes.

Prompt caching compounds the third problem. Major providers discount an input
prefix that is byte-identical to a previous request, typically by a large
fraction and sometimes only above a minimum prefix length. The current prompt
puts the lens definition second, so consecutive lenses share almost no prefix
and qualify for almost none of that discount.

## Decision

Lens prompts embed the source they audit, and are ordered so the invariant part
comes first.

```
[ shared prefix — identical for every lens routed to the same file set ]
  the source under review, line-numbered, files in sorted order
[ lens-specific suffix ]
  lens identity, definition, owns / not-owns, scope notes, output contract
```

Embedding is **on by default**, with `--no-embed` restoring the previous
name-the-files prompt for runners that prefer to read files themselves.

Rejected: **opt-in via `--embed`.** It preserves every existing runner
untouched, and it also means the saving reaches only users who already know the
problem exists. The default is where the behaviour has to change.

Rejected: **collapsing the roster into one dispatch.** It is the largest
possible saving — the source is paid for once rather than once per lens — and it
destroys lens independence, which is the whole basis of the consensus score. A
panel of one is not a panel.

Rejected: **embedding only below a size threshold.** Best token behaviour in
both regimes, at the cost of two prompt shapes, two code paths, and a cost model
that changes with input size. Rejected for this release, not on principle.

The shared prefix is identical only across lenses routed to the *same* file set.
Routing already sends different lenses to different files, so a run's caching
benefit is per routing group, not global.

## Consequences

**If this is right.** A bare model becomes a usable runner, which makes a cheap
tier possible and gives the pre-registered calibration study the weaker arm it
has been missing. Lenses after the first in a routing group hit the provider's
cache on the source. crosscheck can count the input it constructs, so
`--budget` becomes a real cap rather than a proxy, and a pre-flight estimate can
be shown before anything is spent.

**If this is wrong.** Embedding sends the whole in-scope source for every
routing group, whether or not a runner would have read all of it. An agent that
would have opened two of ten files now receives ten. For large file sets against
a runner that reads selectively, this costs more than it saves, and `--no-embed`
is the exit.

**Costs of being right.** Two prompt shapes to maintain and test. Token counts
are estimates from a character heuristic, not a tokenizer — they must be
labelled as estimates everywhere they surface, or the tool trades one invented
number for another.

**Open questions.** Whether the character heuristic is close enough across
tokenizers to enforce a budget without surprising anyone. Whether `scope: hunks`
lenses should embed changed spans plus context rather than whole files by
default, once there is data on what that costs in recall.
