---
name: review-otel-patterns
description: >
  Review TypeScript/JavaScript code for OpenTelemetry instrumentation patterns and guide adoption of autotel.
  Covers Next.js, Nuxt, Nitro, TanStack Start, SvelteKit, NestJS, Express, Hono, Fastify, Elysia,
  Cloudflare Workers, AWS Lambda, edge runtimes, and standalone Node. Detects unstructured tracing,
  missing span attributes, manual exporter setup, broken context propagation, exposed PII, and ad-hoc
  error handling. Covers spans, metrics, logs, structured errors, the autotel processor pipeline
  (tail-sampling, attribute redaction, span-name normalisation, filtering, baggage),
  `defineWorkerFetch` for Cloudflare async drains, multi-vendor OTLP backends (Honeycomb, Datadog,
  Grafana Cloud, Sentry, Axiom, HyperDX), `composeSpanProcessors` / `composeSubscribers` /
  `composePostProcessors` for pipelines, AI SDK observability with gen-ai semantic conventions, and
  end-to-end OTLP testing.
type: review
library: autotel
license: MIT
---

# Review OpenTelemetry patterns

Review and improve OpenTelemetry instrumentation in TypeScript/JavaScript codebases using autotel. Replace ad-hoc tracing with idiomatic OTel-native spans, metrics and structured logs that work across every major framework and edge runtime — without vendor lock-in.

## When to use

- Setting up autotel in a new or existing project (any supported framework)
- Reviewing code for OpenTelemetry best practices
- Converting `console.log` / ad-hoc tracing to spans + structured events
- Improving error handling with structured errors and span status
- Configuring sampling, redaction, processors, or backends
- Migrating between observability vendors

## Quick reference

| Working on…                      | Resource                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| Span design + wide events        | [references/wide-spans.md](references/wide-spans.md)                 |
| Structured errors                | [references/structured-errors.md](references/structured-errors.md)   |
| Code review checklist            | [references/code-review.md](references/code-review.md)               |
| Processor pipeline + composition | [references/processor-pipeline.md](references/processor-pipeline.md) |

## Installation

```bash
npm install autotel
```

For framework-specific helpers, install the relevant package alongside core:

```bash
npm install autotel-cloudflare    # Workers + Durable Objects + Workflows
npm install autotel-edge          # Vendor-agnostic edge runtime base
npm install autotel-hono          # Hono middleware
npm install autotel-tanstack      # TanStack Start
npm install autotel-adapters      # Next.js / Nitro / Hono / Cloudflare adapter toolkit
npm install autotel-vitest        # Span assertions in tests
npm install autotel-playwright    # Browser → server trace propagation
npm install autotel-drizzle       # Drizzle ORM auto-instrumentation
npm install autotel-mongoose      # Mongoose auto-instrumentation
npm install autotel-sentry        # Sentry exporter via OTLP
```

---

## Framework setup

### Next.js (App Router)

Step 1 — Initialise once in `instrumentation.ts`:

```typescript
// instrumentation.ts
import { init } from 'autotel';

export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    init({
      service: 'my-app',
      exporter: { url: process.env.OTLP_ENDPOINT! },
      sampling: { rates: { server: 25, client: 5 } },
      attributeRedactor: 'default',
    });
  }
}
```

Step 2 — Wrap route handlers:

```typescript
// app/api/checkout/route.ts
import { withAutotel } from 'autotel-adapters';

export const POST = withAutotel(async (request: Request) => {
  const log = useLogger();
  log.set({ user: { id: 'usr_123', plan: 'enterprise' } });
  log.set({ cart: { items: 3, total: 14_999 } });
  return Response.json({ ok: true });
});
```

Step 3 — Tag Server Actions the same way (`withAutotel`).

Step 4 — Browser → server trace propagation: drop in `<TraceProvider />` from `autotel-web` so the W3C `traceparent` header is forwarded automatically.

### Nuxt + Nitro v3

```typescript
// nitro.config.ts
import { defineConfig } from 'nitro';
import autotel from 'autotel-adapters/nitro';

export default defineConfig({
  modules: [
    autotel({ service: 'my-api', sampling: { rates: { server: 25 } } }),
  ],
});
```

```typescript
// routes/api/checkout.post.ts
import { useLogger } from 'autotel-adapters/nitro';

export default defineEventHandler(async (event) => {
  const log = useLogger(event);
  log.set({ action: 'checkout', user: { id: event.context.user?.id } });
  return { ok: true };
});
```

### TanStack Start

```typescript
// nitro.config.ts
import autotel from 'autotel-adapters/nitro';
export default defineConfig({
  modules: [autotel({ service: 'my-app' })],
});
```

```typescript
// src/routes/__root.tsx
import { createMiddleware } from '@tanstack/react-start';
import { autotelMiddleware } from 'autotel-tanstack';

export const Route = createRootRoute({
  server: { middleware: [createMiddleware().server(autotelMiddleware())] },
});
```

### Hono

```typescript
import { Hono } from 'hono';
import { honoToolkit } from 'autotel-adapters';

const { useLogger, withAutotel } = honoToolkit;
const app = new Hono();
app.use('*', withAutotel({ service: 'my-api' }));

app.get('/api/users', (c) => {
  const log = useLogger(c);
  log.set({ users: { count: 42 } });
  return c.json({ users: [] });
});
```

### Express / Fastify / Elysia / NestJS

The `autotel-adapters` toolkit ships a uniform shape for these: `withAutotel` middleware + `useLogger()` from anywhere in the call stack. See per-framework docs in `packages/autotel-adapters/skills/autotel-adapters/SKILL.md`.

### Cloudflare Workers (with auto `waitUntil`)

`defineWorkerFetch` instruments the handler **and** wires `ctx.waitUntil` for span exports — without it, async exports silently drop:

```typescript
import { defineWorkerFetch } from 'autotel-cloudflare';

export default defineWorkerFetch(
  { service: { name: 'edge-api' } },
  async (request, env, ctx, log) => {
    log.set({ route: '/health', user: { id: env.userId } });
    return new Response('ok');
  },
);
```

For broader use cases (`scheduled`, `queue`, `email` handlers, Durable Objects, Workflows), use `wrapModule` / `wrapDurableObject` / `instrumentWorkflow` — same auto-`waitUntil` semantics.

### AWS Lambda

```typescript
import { withLambda } from 'autotel-aws';

export const handler = withLambda(async (event) => {
  const log = useLogger();
  log.set({ event: { source: event.source } });
  return { statusCode: 200 };
});
```

### Standalone Node / scripts

```typescript
import { init, trace } from 'autotel';

init({ service: 'my-worker', exporter: { url: process.env.OTLP_ENDPOINT! } });

const processJob = trace(async (job: Job) => {
  // span auto-named after the function
  const log = useLogger();
  log.set({ job: { id: job.id, source: job.source } });
});
```

---

## Configuration options

All options work with `init()`, framework adapters, and `wrapModule` / `defineWorkerFetch`:

| Option                                  | Type                                                            | Default           | Description                                                     |
| --------------------------------------- | --------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| `service` / `service.name`              | `string`                                                        | `'app'`           | Service name in `service.name` resource attribute               |
| `exporter`                              | `{ url, headers?, protocol? }`                                  | —                 | OTLP HTTP/JSON or HTTP/protobuf endpoint                        |
| `spanProcessors`                        | `SpanProcessor[]`                                               | —                 | Use **instead of** `exporter` for full control                  |
| `sampling.rates`                        | `{ server?: number, client?: number, internal?: number }`       | `100%`            | Head sampling per span kind (0–100%)                            |
| `sampling.tail`                         | `TailSampleFn`                                                  | —                 | Keep traces matching predicate (e.g. errors, slow)              |
| `attributeRedactor`                     | `'default' \| 'strict' \| 'pci-dss' \| AttributeRedactorConfig` | —                 | PII redaction; on by default in production                      |
| `instrumentation.disabled`              | `boolean`                                                       | `false`           | Hard-off switch (ideal for local dev)                           |
| `instrumentation.instrumentGlobalFetch` | `boolean`                                                       | `true`            | Patch `globalThis.fetch` for outbound HTTP spans                |
| `subscribers`                           | `EdgeSubscriber[]`                                              | —                 | In-process side effects (metrics, audit, AI cost)               |
| `postProcessor`                         | `PostProcessorFn`                                               | —                 | Mutate spans before export (redact, drop, tag)                  |
| `propagator`                            | `TextMapPropagator`                                             | W3C trace-context | Override propagation format                                     |
| `dataSafety`                            | `DataSafetyConfig`                                              | —                 | Per-attribute safety (`captureDbStatement: 'obfuscated'`, etc.) |

---

## Backends (multi-vendor OTLP)

Switch backends with **no code changes** — autotel speaks OTLP HTTP/JSON and HTTP/protobuf out of the box.

| Backend                          | Endpoint                                                   | Headers                               |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Honeycomb                        | `https://api.honeycomb.io/v1/traces`                       | `{ 'x-honeycomb-team': '<key>' }`     |
| Grafana Cloud                    | `https://otlp-gateway-<region>.grafana.net/otlp/v1/traces` | `{ authorization: 'Basic <b64>' }`    |
| Datadog (OTLP intake)            | `https://trace.agent.datadoghq.com/api/v0.4/traces`        | `{ 'dd-api-key': '<key>' }`           |
| Sentry                           | `<dsn>/api/<id>/envelope/` (use `autotel-sentry`)          | `{ 'x-sentry-auth': '…' }`            |
| Axiom                            | `https://api.axiom.co/v1/traces`                           | `{ authorization: 'Bearer <token>' }` |
| HyperDX                          | `https://in-otel.hyperdx.io/v1/traces`                     | `{ authorization: '<key>' }`          |
| New Relic                        | `https://otlp.nr-data.net/v1/traces`                       | `{ 'api-key': '<key>' }`              |
| Local Jaeger / Tempo / Collector | `http://localhost:4318/v1/traces`                          | —                                     |

Use `init({ exporter: { url, headers } })`. Multiple destinations? Use `composeSpanProcessors([batchA, batchB])` (see Composition below).

---

## Auto-redaction (PII protection)

Built-in masking scrubs sensitive data from span attributes **before** export. **On by default in production**, off in development. Smart partial masking preserves debug signal:

| Pattern      | Example input         | Masked output                                |
| ------------ | --------------------- | -------------------------------------------- |
| `creditCard` | `4111-1111-1111-1111` | `****1111` (PCI-DSS compliant)               |
| `email`      | `alice@example.com`   | `a***@***.com`                               |
| `ipv4`       | `192.168.1.100`       | `***.***.***.100`                            |
| `phone`      | `+33 6 12 34 56 78`   | `+33******78` (requires `+cc` or `(parens)`) |
| `jwt`        | `eyJhbGciOi…`         | `eyJ***.***`                                 |
| `bearer`     | `Bearer sk_live_abc…` | `Bearer ***`                                 |
| `iban`       | `FR76 3000 6000 …189` | `FR76****189`                                |

Three presets ship out of the box: `'default'` (PII-grade), `'strict'` (adds JWT / Bearer / IBAN, redacts more keys), `'pci-dss'` (cards only, PCI focus).

```typescript
init({
  service: 'my-app',
  attributeRedactor: 'default',
});
```

Custom config:

```typescript
import { builtinPatterns, type AttributeRedactorConfig } from 'autotel';

const config: AttributeRedactorConfig = {
  keyPatterns: [/password/i, /^x-internal-/i],
  builtins: ['email', 'creditCard', 'jwt'], // pick specific masks
  valuePatterns: [
    { name: 'customerId', pattern: /CUST-\d{8}/g, replacement: 'CUST-***' },
  ],
};
init({ attributeRedactor: config });
```

For free-text fields outside the span pipeline (logs, error messages, frontend payloads), use `createStringRedactor('default')` — same masks, returns a `(s: string) => string`.

---

## Composition (build pipelines from small parts)

```typescript
import {
  composeSpanProcessors,
  composeSubscribers,
  composePostProcessors,
  defineConfig,
} from 'autotel-edge';

export const otelConfig = defineConfig({
  service: { name: 'checkout' },
  spanProcessors: composeSpanProcessors([
    new BatchSpanProcessor(honeycombExporter),
    new BatchSpanProcessor(datadogExporter),
    new TailSamplingProcessor({ keep: { errors: true, slow: 500 } }),
  ]),
  subscribers: [
    composeSubscribers([metricsSubscriber, auditSubscriber, aiCostSubscriber]),
  ],
  postProcessor: composePostProcessors([
    redactPiiInStackTraces,
    dropHealthChecks,
  ]),
});
```

Errors are isolated per item — one bad processor cannot break the others. See [references/processor-pipeline.md](references/processor-pipeline.md) for the full pipeline cookbook.

---

## Processors (autotel-specific superpowers)

| Processor                      | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `AttributeRedactingProcessor`  | PII masking with smart partial output                       |
| `TailSamplingProcessor`        | Keep errors + slow + sampled-by-rate                        |
| `FilteringSpanProcessor`       | Drop spans matching predicate (health checks, etc.)         |
| `SpanNameNormalizingProcessor` | Normalise `/users/123` → `/users/{id}` to bound cardinality |
| `BaggageSpanProcessor`         | Lift baggage entries onto every span                        |
| `PrettyConsoleExporter`        | Hierarchical colourised output for local dev                |

Compose them at build time with `composeSpanProcessors([...])` — no boilerplate.

---

## AI SDK integration (gen-ai semantic conventions)

autotel implements the **OTel gen-ai semantic conventions** out of the box. Token usage, tool calls, model info, latency, cost — captured as standard attributes (`gen_ai.usage.input_tokens`, `gen_ai.tool.name`, `gen_ai.response.finish_reason`, …) so any backend that understands OTel can render LLM telemetry without custom mapping.

```typescript
import { trace } from 'autotel';
import { withAiTelemetry } from 'autotel-edge';
import { streamText } from 'ai';

const handler = trace(async (req) => {
  const result = await streamText({
    model: withAiTelemetry('anthropic/claude-sonnet-4.6'),
    messages: req.messages,
    experimental_telemetry: { isEnabled: true },
  });
  return result.toResponse();
});
```

Captured attributes per call: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.{input,output,reasoning,cache_read}_tokens`, `gen_ai.response.finish_reason`, `gen_ai.response.id`, plus per-tool spans with `gen_ai.tool.name`, `gen_ai.tool.duration`. Cost estimation comes for free if you pass a pricing map to `withAiTelemetry`.

Anti-patterns to detect:

| Anti-pattern                          | Fix                                                       |
| ------------------------------------- | --------------------------------------------------------- |
| Manual `result.usage` printing        | `withAiTelemetry()` — captures via middleware             |
| Custom `ai.tokens` attribute names    | Use OTel gen-ai conventions (`gen_ai.usage.input_tokens`) |
| Tool calls as plain log lines         | Each tool call gets a child span automatically            |
| No retry / partial-failure visibility | `experimental_telemetry: { isEnabled: true }` flips it on |

---

## Structured errors

Throw rich errors that carry status, audience, and remediation hints — and consume them at HTTP boundaries:

```typescript
import { createStructuredError, parseError } from 'autotel';

throw createStructuredError({
  message: 'Payment declined',
  status: 402,
  why: 'Card declined by issuer — insufficient funds',
  fix: 'Use a different payment method or contact your bank',
  link: 'https://docs.example.com/payments/declined',
  internal: { correlationId: 'req_abc', resourceId: 'cust_123' },
});

// at the HTTP boundary
app.onError((error, c) => {
  const parsed = parseError(error);
  // `internal` is stripped from `parsed` — never returned to clients
  return c.json(parsed, parsed.status);
});
```

`createStructuredError` records the error onto the active span automatically (`exception.type`, `exception.message`, `exception.stacktrace`) and sets `span.status = ERROR`.

See [references/structured-errors.md](references/structured-errors.md) for templates.

---

## Testing your instrumentation

### Unit tests (in-memory exporter)

```typescript
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';
import { init, trace } from 'autotel';

const exporter = new InMemorySpanExporter();
init({ service: 'test', spanProcessors: [new SimpleSpanProcessor(exporter)] });

await trace(async () => {
  // … code under test
})();

const spans = exporter.getFinishedSpans();
expect(spans).toContainSpan({
  name: 'processOrder',
  attributes: { 'order.id': '123' },
});
```

`autotel-vitest` ships a custom matcher (`toContainSpan`) and a `withSpans()` helper.

### End-to-end (real OTLP backend)

`packages/autotel/test/e2e/` ships a working OTLP HTTP/JSON smoke test that tags every span with `e2e_run_id` / `e2e_correlation_id` for cleanup, skips gracefully when env vars are missing, and is wired up to a daily GitHub Actions cron. Copy it to test against your own backend (Honeycomb, Grafana Cloud, Datadog, …):

```bash
pnpm --filter autotel run test:e2e
```

### Bundle size guard

`scripts/check-bundle-size.mjs` measures every `packages/autotel*/dist` against `bundle-size-baseline.json` and fails CI on growth past 5 % / 2 KiB. Update the baseline only when the growth is intentional.

---

## Anti-patterns to detect

| Anti-pattern                                        | Fix                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `console.log` in handlers                           | Use `useLogger()` — fields land on the active span                  |
| Manual `tracer.startSpan` boilerplate               | `trace(fn)` — auto-named, auto-ended, auto-status                   |
| `try { … } catch (e) { console.error(e); throw e }` | Replace with `createStructuredError({ … })`                         |
| `throw new Error('something went wrong')`           | `createStructuredError({ message, status, why, fix })`              |
| Ad-hoc `span.setAttribute('user_id', id)`           | Use `useLogger().set({ user: { id } })` — flattens with stable keys |
| Multiple exporters wired in parallel by hand        | `composeSpanProcessors([…])`                                        |
| PII in attributes                                   | `attributeRedactor: 'default'` (on in prod by default)              |
| Cloudflare Workers without `waitUntil`              | Use `defineWorkerFetch` / `wrapModule`                              |
| High-cardinality span names (`/users/123`)          | `SpanNameNormalizingProcessor`                                      |
| AI SDK token logs                                   | `withAiTelemetry()` + gen-ai semantic conventions                   |
| Health checks blowing up trace volume               | `FilteringSpanProcessor`                                            |
| No tests for instrumentation                        | `InMemorySpanExporter` + `autotel-vitest` matchers                  |
| Manual context propagation in fetch                 | `instrumentation.instrumentGlobalFetch: true` (default)             |

See [references/code-review.md](references/code-review.md) for the full checklist.

---

## Why autotel beats manually-wired OTel

| Concern               | Plain `@opentelemetry/sdk-node`                      | autotel                                               |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Setup                 | Multi-page checklist, vendor-specific resource attrs | One `init()` call, sane defaults                      |
| Cloudflare Workers    | DIY `waitUntil` (logs/spans drop silently if missed) | `defineWorkerFetch` auto-wires it                     |
| PII redaction         | DIY span processor                                   | `attributeRedactor: 'default'` (smart masks built in) |
| High-cardinality URLs | DIY span name munging                                | `SpanNameNormalizingProcessor`                        |
| Multi-backend         | Hand-write a tee processor                           | `composeSpanProcessors([…])`                          |
| Local debugging       | Manual `ConsoleSpanExporter` plumbing                | `init({ debug: 'pretty' })`                           |
| AI SDK                | Custom attributes, vendor-specific dashboards        | OTel gen-ai semconv out of the box                    |
| Bundle size           | Unbounded                                            | CI guard with `bundle-size-baseline.json`             |
| Real-backend tests    | DIY                                                  | `pnpm test:e2e` ships a working OTLP smoke test       |

---

## Loading reference files

Load based on what you're working on — **do not load all at once**:

- Designing spans → [references/wide-spans.md](references/wide-spans.md)
- Improving errors → [references/structured-errors.md](references/structured-errors.md)
- Full code review → [references/code-review.md](references/code-review.md)
- Pipeline / processors → [references/processor-pipeline.md](references/processor-pipeline.md)
