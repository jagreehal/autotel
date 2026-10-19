---
name: autotel-edge
description: >
  Use this skill when adding OpenTelemetry to an edge runtime with no Node.js APIs (Cloudflare Workers, Vercel Edge, Deno) — trace(), span(), instrument(), sampling, events, and the request logger, kept bundle-size lean.
---

# autotel-edge

Vendor-agnostic OpenTelemetry for edge runtimes: Cloudflare Workers, Vercel Edge, Netlify Edge, Deno Deploy. Same functional API as autotel (trace, span, instrument) with a small bundle (~20KB). No Node.js APIs; use where autotel (Node) cannot run.

## Setup

There is no `init()`. Parse a config once per isolate, register a `WorkerTracerProvider`, and set its tracer's head sampler; `trace()` and `span()` then use the global tracer.

```typescript
import { resourceFromAttributes } from '@opentelemetry/resources'; // add as a direct dependency
import { parseConfig, WorkerTracerProvider, trace } from 'autotel-edge';

const config = parseConfig({
  service: { name: 'edge-api' },
  exporter: { url: 'https://otlp.example.com/v1/traces', headers: {} },
});

const provider = new WorkerTracerProvider(
  config.spanProcessors,
  resourceFromAttributes({ 'service.name': config.service.name }),
);
provider.register(); // also installs the AsyncLocalStorage context manager
// Applies sampling.headSampler; without it every trace is head-sampled.
provider.getTracer('autotel-edge').setHeadSampler(config.sampling.headSampler);

export const handler = trace(async function fetch(request: Request) {
  return new Response('ok');
});
```

Without `exporter` or `spanProcessors`, `parseConfig` warns once and spans are dropped. A trace is flushed when its local root span ends; for traces that continue a remote parent, call `await provider.getTracer('autotel-edge').forceFlush(traceId)` (e.g. inside `waitUntil`). On Cloudflare, use `autotel-cloudflare` instead: its wrappers do all of this per request.

## Entry points

- `autotel-edge`: functional API (`trace`, `span`, `instrument`, `withTracing`, `getActiveTraceContext`), config (`parseConfig`, `createInitialiser`, `setConfig`, `getActiveConfig`), `WorkerTracerProvider`, `OTLPExporter`, `defineConfig`, `definePlugin`, `parseError`
- `autotel-edge/sampling`: tail samplers (`createAdaptiveTailSampler`, `createErrorOnlyTailSampler`, `createSlowOnlyTailSampler`, `combineTailSamplers`, `SamplingPresets`), passed as `sampling.tailSampler`
- `autotel-edge/events`: `createEdgeSubscribers`, `getEdgeSubscribers`
- `autotel-edge/logger`: `createEdgeLogger`, `getExecutionLogger`, `createRedactor`
- `autotel-edge/parse-error`: `parseError`
- `autotel-edge/testing`: currently empty; no test helpers yet

## Core patterns

Use `trace()`, `span()`, `instrument()` the same way as in autotel. Register the provider once at module scope, not per request. For Cloudflare bindings and handler wrappers, use `autotel-cloudflare` on top of autotel-edge.

## Common mistakes

### HIGH Use Node-only APIs (fs, process, etc.) in code that runs on autotel-edge

Edge runtimes do not provide general Node.js APIs. Keep code that runs on the edge free of Node modules. autotel-edge itself imports only `node:async_hooks` (AsyncLocalStorage) and `node:events`, so on Cloudflare enable the `nodejs_compat` compatibility flag.

Source: packages/autotel-edge/CLAUDE.md

### MEDIUM Import from "autotel" in an edge worker

In edge workers use `autotel-edge` (and optionally `autotel-cloudflare`), not `autotel`. The Node package is not bundleable for edge.

Source: packages/autotel-edge/CLAUDE.md

## Version

Targets autotel-edge. See also: autotel-cloudflare for Cloudflare Workers instrumentation and bindings.
