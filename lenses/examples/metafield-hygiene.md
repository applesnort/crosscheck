---
name: metafield-hygiene
summary: Liquid metafield reads, storefront access, and app-embed cost rules
when: [extensions/**/*.liquid, app/lib/fitment/setup.server.ts, app/lib/fitment/templates.ts]
owns: unregistered metafield reads in Liquid, storefront-access grants, app-embed placement
not-owns: correctness, security, usability, naming
---

# Lens: metafield-hygiene

These rules exist because breaking them takes a storefront down — HTTP 500 on
every page, until someone finds the offending read. Treat a violation as BLOCK,
not style.

**1. Every `shop.metafields.*` read in Liquid must have a registered definition.**

Reading `shop.metafields.NAMESPACE.KEY.value` in Liquid when the definition was
never created via `metafieldDefinitionCreate` makes Shopify's Liquid complexity
analyzer charge roughly a 15,000-point cold-cache penalty *per render*. On a
`target: body` app embed that fires on every page in the store and blows the
render ceiling, which Shopify serves as a 500.

Report a read whose namespace/key pair does not appear in `CPF_METAFIELDS` in
`app/lib/fitment/templates.ts`. Report a new `CPF_METAFIELDS` entry that
`provisionCpfSetup` in `app/lib/fitment/setup.server.ts` does not provision --
an entry nothing creates is a definition that will be missing at runtime, which
is the same failure.

**2. `access.storefront: PUBLIC_READ` is opt-in.**

The default is `NONE`. Report a definition granting storefront read access
without a storefront-side reader to justify it. It is an attractive nuisance:
the next person to touch Liquid will assume the value is cheap to read.

**3. Shop-wide config belongs on the app proxy, not in Liquid.**

Data that is shop-wide rather than per-page should be served from
`/apps/fitment-results?mode=...` and fetched client-side. Admin GraphQL reads are
cheap; Liquid metafield reads are the expensive ones. Report new Liquid that
reads shop-wide configuration a proxy mode already serves or could serve.

**4. `target: body` app embeds are a last resort.**

They render on every page in the store, so any Liquid cost inside one is
multiplied by the entire storefront. Report a new `target: body` block, or new
cost added inside an existing one, where a `target: section` block the merchant
places deliberately would do.

Findings only, one per line: `file:line — SEVERITY — issue — fix`.
SEVERITY is BLOCK, FIX, or CONSIDER. Reply exactly `NO FINDINGS` if none.
