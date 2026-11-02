---
'autotel-adapters': patch
---

The `keep` option keeps a request's trace in every adapter. Set `ctx.shouldKeep = true` and the adapter calls `forceKeep()` on the request span, streamed responses and Express and Fastify included. Request spans carry `autotel.sampling.tail.keep` only when `keep` asks for it.
