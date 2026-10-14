---
'autotel-web': minor
'autotel-posthog': patch
---

Lean `traceparent` now carries the session's sampling decision: `01` inside `sampleRate`, `00` outside it, with or without an `endpoint`. Match the browser `sampleRate` to your API's ratio and a parent-based server sampler keeps the same sessions. `createTraceparent()` takes an optional `sampled` argument. A `session.id` provider that throws falls back to the local session id.

The `posthogSessionId` examples now pass the imported `posthog` instance.

New example: `apps/example-web-react-express`, a React + axios SPA with a cross-origin Express API, verified in headless Chromium.
