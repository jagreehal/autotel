---
'autotel-devtools': minor
---

The fullpage widget now honours a URL-hash deep-link: `#trace=<id>&span=<id>` opens the widget on the Traces waterfall focused on that trace/span once it arrives over the wire. Exposed via a new optional `deepLink` on `mountWidget`'s props and the `requestDeepLink(traceId, spanId?)` store helper. Lets an embedder (e.g. the VS Code extension) point an iframe at `/#trace=…` and land on the right span. (Also removes the unused `?position=` script param.)
