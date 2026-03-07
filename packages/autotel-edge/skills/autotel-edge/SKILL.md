---
name: autotel-edge
description: >
  OpenTelemetry for edge runtimes (Cloudflare Workers, Vercel Edge, Deno). trace(), span(), instrument(); sampling, events, logger. Bundle-size optimized; no Node.js APIs.
type: core
library: autotel-edge
sources:
  - jagreehal/autotel:packages/autotel-edge/CLAUDE.md
---

# autotel-edge

Vendor-agnostic OpenTelemetry for edge runtimes: Cloudflare Workers, Vercel Edge, Netlify Edge, Deno Deploy. Same functional API as autotel (trace, span, instrument) with a small bundle (~20KB). No Node.js APIs; use where autotel (Node) cannot run.

## Setup

```typescript
import { init, trace } from 'autotel-edge';

init({ service: 'edge-api' });

const handler = trace(async (request: Request) => {
  return new Response('ok');
});
```

## Entry points

- `autotel-edge` — core (trace, span, instrument, init)
- `autotel-edge/sampling` — sampling strategies
- `autotel-edge/events` — events with trace correlation
- `autotel-edge/logger` — trace-aware logger
- `autotel-edge/testing` — test utilities

## Core patterns

Use `trace()`, `span()`, `instrument()` the same way as in autotel. Init once at the top of your worker/module. For Cloudflare-specific bindings and handler wrappers, use `autotel-cloudflare` on top of autotel-edge.

## Common mistakes

### HIGH Use Node-only APIs (fs, process, etc.) in code that runs on autotel-edge

Edge runtimes do not provide Node.js APIs. Keep code path that runs on the edge free of Node modules. autotel-cloudflare and other edge packages use only fetch, AsyncLocalStorage (or polyfill), and standard APIs.

Source: packages/autotel-edge/CLAUDE.md

### MEDIUM Import from "autotel" in an edge worker

In edge workers use `autotel-edge` (and optionally `autotel-cloudflare`), not `autotel`. The Node package is not bundleable for edge.

Source: packages/autotel-edge/CLAUDE.md

## Version

Targets autotel-edge. See also: autotel-cloudflare for Cloudflare Workers instrumentation and bindings.
