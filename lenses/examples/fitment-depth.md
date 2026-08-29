---
name: fitment-depth
summary: the two depths -- search depth vs fitment depth -- and where each may be applied
when: [app/lib/fitment/**/*.ts, app/routes/apps.fitment-results.tsx, app/routes/app.fitment.tsx, extensions/**/*.liquid, extensions/**/*.js]
owns: confusing search depth with fitment depth, client-supplied depth, truncation on the wrong path
not-owns: general correctness, security, style, performance
---

# Lens: fitment-depth

A template carries two different depths. Confusing them produces wrong
"Does not fit" verdicts on parts that genuinely fit.

| field | metaobject key | controls |
| --- | --- | --- |
| search depth | `max_depth` | dropdowns the finder asks for, and levels a **search** matches on |
| fitment depth | `fitment_depth` | levels that decide the **fits / does not fit** verdict on a product page |

**1. Never read `fitment_depth` directly.**

It must go through `resolveFitmentDepth()` in `app/lib/fitment/templates.ts`,
which clamps to `1 <= fitmentDepth <= maxDepth` and falls back to `maxDepth`
when unset. That fallback is how every template behaved before the setting
existed, so an unset value must never be a behavior change. Report any
`fitment_depth` / `fitmentDepth` read that parses the raw field and uses it
without going through the resolver.

**2. Fitment depth is resolved server-side and never accepted from the request.**

Report any path that reads a depth from query params, request body, headers, or
client-supplied JSON and lets it reach a verdict. A shopper who can set the depth
can make every product claim to fit their vehicle.

**3. Search paths must not truncate.**

`truncateLevelsToDepth()` belongs only on verdict paths. Applying it to
`queryStorefrontFitmentMatches` -- or to anything serving `mode=search` or
`mode=options` -- silently broadens every finder search. Report truncation
reached from a search or options path.

**4. A verdict must not claim levels it did not compare.**

The three product-page verdict surfaces are `fitment_product_notice.liquid`,
`fitment_table.liquid`, and the inline notice in `fitment-inject-v2.js`. They
defer to `/apps/fitment-results?mode=check` and fall back to their own stricter
client-side matching only when the proxy is unreachable. Report a surface that
renders a verdict from search results instead of `mode=check`, or one that names
more levels in its label than the depth the verdict was decided on -- that
asserts a fit across levels nothing verified.

Findings only, one per line: `file:line — SEVERITY — issue — fix`.
SEVERITY is BLOCK, FIX, or CONSIDER. Reply exactly `NO FINDINGS` if none.
