---
name: autotel-cloudflare
description: >
  Instruments Cloudflare Workers end to end: fetch, scheduled, queue and email
  handlers, every binding (KV, R2, D1, AI, Vectorize, Queues, Durable Objects),
  ctx.waitUntil draining, and Cloudflare's native tracing. Use this skill when
  tracing a Worker or deciding between native tracing and autotel's OTLP exporter.
  Do not use for non-Cloudflare edge runtimes — use skill autotel-edge — or for
  browser-side tracing, which skill autotel-web covers.
---

# autotel-cloudflare

Complete OpenTelemetry for Cloudflare Workers. Three API styles, full bindings coverage.

## Quick Start: pick one style

### Style 1: instrument() (recommended)

```typescript
import { instrument, instrumentKV } from 'autotel-cloudflare';

export default instrument(
  {
    async fetch(req, env, ctx) {
      const kv = instrumentKV(env.MY_KV, { name: 'my-kv' });
      const val = await kv.get('key'); // traced automatically
      return new Response(val);
    },
  },
  { service: { name: 'my-worker' } },
);
```

### Style 2: wrapModule()

```typescript
import { wrapModule } from 'autotel-cloudflare';

export default wrapModule(
  { service: { name: 'my-worker' } },
  {
    async fetch(req, env, ctx) {
      return new Response('OK');
    },
  },
);
```

### Style 3: Functional (from autotel-edge)

```typescript
import { trace } from 'autotel-cloudflare';
export default { fetch: trace(async (req) => new Response('OK')) };
```

## Bindings Instrumentation

Every Cloudflare binding has a wrapper. Each creates spans for all operations.

| Binding         | Wrapper                                                         | Import                              |
| --------------- | --------------------------------------------------------------- | ----------------------------------- |
| KV              | `instrumentKV(env.KV, { name })`                                | `autotel-cloudflare` or `/bindings` |
| R2              | `instrumentR2(env.BUCKET, { name })`                            | same                                |
| D1              | `instrumentD1(env.DB, { name })`                                | same                                |
| Service Binding | `instrumentServiceBinding(env.SVC, { name })`                   | same                                |
| Workers AI      | `instrumentAI(env.AI)`                                          | same                                |
| Vectorize       | `instrumentVectorize(env.INDEX, { name })`                      | same                                |
| Hyperdrive      | `instrumentHyperdrive(env.HD, { name })`                        | same                                |
| Queue Producer  | `instrumentQueueProducer(env.QUEUE, { name })`                  | same                                |
| Durable Objects | `instrumentDO(DOClass)` or `wrapDurableObject(config, DOClass)` | same                                |

Or use `instrumentBindings(env)` to auto-instrument all bindings at once.

## Native tracing

With `[observability.traces] enabled = true` in `wrangler`, Cloudflare instruments bindings and exports OTLP itself. autotel detects `ctx.tracing` and nests your `trace()` / `span()` / `enterSpan()` calls in the platform waterfall, skips its own binding instrumentation, and registers no second exporter. You get one set of spans, not two.

| `nativeTracing` | Behaviour                                                  |
| --------------- | ---------------------------------------------------------- |
| `'auto'`        | Default. Native when `ctx.tracing` exists, otherwise OTLP. |
| `'on'`          | Prefer native; warn once and fall back when absent.        |
| `'off'`         | Always autotel's OTLP exporter.                            |

Leave it at `'auto'`. `wrangler dev` does not export native traces locally, so the fallback carries local development to `npx autotel-devtools`.

## Handler Types

`instrument()` and `wrapModule()` automatically trace: `fetch`, `scheduled`, `queue`, `email`.

## Common Mistakes

- Do NOT call `instrumentKV()` etc. outside the handler: bindings aren't available at module scope.
- Do NOT use `await import()` for dynamic imports: use autotel's `safeRequire` helpers.
- Use `autotel-cloudflare/bindings` for tree-shaking if you only need binding wrappers.
