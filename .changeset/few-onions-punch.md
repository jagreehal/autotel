---
'autotel': patch
---

Use boxed values in AsyncLocalStorage so `enterOrRun()` can mutate the existing store on runtimes without `enterWith()` (Cloudflare Workers). This keeps baggage and context updates visible within the same traced callback. `startActiveSpan` calls now also explicitly pass the parent context.
