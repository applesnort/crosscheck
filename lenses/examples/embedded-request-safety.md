---
name: embedded-request-safety
summary: how embedded admin routes must issue requests and parse responses
when: [app/routes/app*.tsx, app/routes/app/**/*.tsx, app/components/**/*.tsx]
owns: raw fetch in embedded admin routes, unguarded response parsing, session-redirect handling
not-owns: fitment logic, Liquid cost, storefront code, styling
---

# Lens: embedded-request-safety

Inside the Shopify admin iframe a session can expire between render and submit.
When it does, the app proxy answers with an HTML login redirect rather than
JSON, and code that assumed JSON surfaces `Unexpected token '<'` to the merchant
-- an error that says nothing about what actually happened or how to recover.

**1. In-app admin route actions go through React Router, not raw fetch.**

For routes under `app/routes/app*`, submissions belong in `useFetcher().submit`
or `<fetcher.Form>`. Report a raw `fetch(window.location...)` or a hand-built
request to an `/app/*` action where a fetcher submission is what the codebase
uses everywhere else.

**2. If raw fetch is genuinely unavoidable, never call `response.json()`.**

The required shape is: read `response.text()`, check `response.ok`, check that
`content-type` includes `application/json`, then `JSON.parse`. Report a direct
`.json()` call on a response from an app route, and report a parse that skips
either the `ok` check or the content-type check -- each one is the same crash
with a different trigger.

**3. An HTML body is a session redirect, and must be reported as one.**

A response starting `<!doctype` or `<html` means the session expired. Report
code that lets that reach a JSON parser, or that renders the raw parse error to
the merchant instead of a clear refresh-and-retry message.

**4. Touch targets on custom interactive elements.**

Custom `<button>`, `<input>`, and styled links need a 36px minimum
(`minHeight: "2.25rem"`). Shopify's own web components (`s-button`, `s-select`)
already meet it and are not in scope. Report a custom interactive element added
without it. This one is CONSIDER unless the element is a primary action.

Findings only, one per line: `file:line — SEVERITY — issue — fix`.
SEVERITY is BLOCK, FIX, or CONSIDER. Reply exactly `NO FINDINGS` if none.
