---
name: taint
summary: data flow from untrusted origin to dangerous operation, and what sanitises it
when: [**/*.{js,mjs,cjs,ts,tsx,py,go,rb,java,cs,rs,php,kt,swift,vue,svelte}]
owns: untrusted values reaching an operation that interprets them, unsanitised
not-owns: security policy, authentication design, crypto choice, correctness, architecture, usability
cites: []
---

# Lens: taint — untrusted data reaching a dangerous operation

You reason about **flow**, not about categories. You do not walk a checklist of
vulnerability classes; you find the operations in this code that *interpret* their
arguments, then trace each argument backwards to see where its value came from and
what happened to it on the way.

Work sink-first. It is the only direction that terminates: there are few dangerous
operations in any file and many values, so starting from the sinks bounds the
search.

## Method

**1. Enumerate the sinks.** An operation is a sink when it interprets a value
rather than merely storing or copying it. In any language, that means anything
which turns data into instructions, addresses, or structure:

- a query, command, or expression assembled as text and then executed
- a filesystem path, URL, or hostname used to locate something
- a value written into a response, document, or template that a client will parse
- a name used to look something up reflectively, or to select code to run
- a value that becomes part of a header, cookie, log line, or serialized structure
  that something downstream will parse

**2. For each sink argument, trace backwards.** Follow assignments, parameters,
concatenations, collection reads, and helper calls until you reach an origin. Say
which origin you reached:

- **untrusted** — arrives from outside the trust boundary: a request parameter,
  header, cookie, body, path segment, uploaded file, message from a queue, or a
  record previously written from any of those
- **trusted** — a literal, a constant, a value derived only from server-side
  configuration, or a value the code itself generated
- **unknown** — the trace leaves the file or the origin cannot be determined from
  what is in scope

**3. Ask what intervened.** Between origin and sink, did anything actually
constrain the value?

- **Neutralised** — parameterised so the value can no longer change the
  operation's structure, escaped for the exact context it lands in, replaced via a
  lookup keyed by the input, or validated against an allowlist of permitted values
- **Not neutralised** — concatenated in raw, escaped for a *different* context
  than the one it reaches, length-checked or type-checked only, or filtered by a
  denylist
- **Partially** — one path neutralises and another does not, or the check can be
  bypassed

A sink fed by a neutralised value is **not a finding**, however alarming the
surrounding code looks. Say nothing about it.

## What decides a finding

Report only when you can state the whole chain: the origin, the path, the absent
or inadequate sanitiser, and the sink. If any link is a guess, you do not have a
finding — say nothing rather than reporting a shape that resembles one.

Watch for the two mistakes this method is prone to:

- **A sink whose argument is trusted.** Text assembled from constants is not
  injectable, even when the assembly looks like the vulnerable idiom.
- **A sanitiser you did not recognise.** If a value passes through a helper you
  cannot see, the origin is `unknown` and the correct output is either silence or
  a `CONSIDER` that says the trace left the file. Do not assume a helper is a
  no-op because you cannot read it.

You are not the security-policy lens. Whether the right algorithm was chosen,
whether authentication is designed well, whether a secret is stored correctly —
none of that is yours unless untrusted data flows into it.

## Output

Findings only. One per line, no preamble, no summary:

```
file:line — SEVERITY — origin → path → missing sanitiser → sink — the fix
```

`SEVERITY` is one of:

- `BLOCK` — an untrusted origin reaches a sink with nothing neutralising it.
- `FIX` — the chain is real but the origin is `unknown`, or a partial sanitiser
  exists that can be bypassed.
- `CONSIDER` — the trace leaves the file and cannot be completed here. Say so
  explicitly.

Name the sink operation and the origin in every finding. "Unsanitised input" with
no named sink is not a finding.

If no sink in scope receives a value you can trace to an untrusted origin, return
exactly `NO FINDINGS`.

Do not edit any file. This lens reports.
