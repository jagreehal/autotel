---
name: review-otel-patterns
description: >
  Review TypeScript/JavaScript code for OpenTelemetry instrumentation patterns and guide adoption of autotel.
  Covers Next.js, Nuxt, Nitro, TanStack Start, SvelteKit, NestJS, Express, Hono, Fastify, Elysia,
  Cloudflare Workers, AWS Lambda, edge runtimes, and standalone Node. Detects unstructured tracing,
  missing span attributes, manual exporter setup, broken context propagation, exposed PII, and ad-hoc
  error handling. Covers spans, metrics, logs, structured errors, the autotel processor pipeline
  (tail-sampling, attribute redaction, span-name normalisation, filtering, baggage),
  built-in enrichers (user agent, geo, request size) and custom `defineEnricher`,
  `defineWorkerFetch` for Cloudflare async drains, multi-vendor OTLP backends (Honeycomb, Datadog,
  Grafana Cloud, Sentry, Axiom, HyperDX), `composeSpanProcessors` / `composeSubscribers` /
  `composePostProcessors` for pipelines, AI SDK observability with gen-ai semantic conventions, and
  end-to-end OTLP testing.
---

# Review OpenTelemetry patterns

Review and improve OpenTelemetry instrumentation in TypeScript/JavaScript codebases using autotel. Replace ad-hoc tracing with idiomatic OTel-native spans, metrics and structured logs that work across every major framework and edge runtime. Without vendor lock-in.

## Start with the scanner

Before reviewing a whole repo by hand, run `npx autotel map --json --no-write`. It
finds every entry point, names which are dark, and carries a `fix` with each
finding. Work its ranked list first, then use this skill for the judgement it
cannot make: span naming, cardinality, what belongs in a wide event, processor
and backend configuration. Skill `find-observability-gaps` covers the scanner.

## When to use

- Setting up autotel in a new or existing project (any supported framework)
- Reviewing code for OpenTelemetry best practices
- Converting `console.log` / ad-hoc tracing to spans + structured events
- Improving error handling with structured errors and span status
- Configuring sampling, redaction, processors, or backends
- Migrating between observability vendors

## Reference files

Load the one that matches the work in front of you. **Do not load them all.**

| Working on…                                | Read                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Full code review                           | [references/code-review.md](references/code-review.md)               |
| Span design + wide events                  | [references/wide-spans.md](references/wide-spans.md)                 |
| Structured errors                          | [references/structured-errors.md](references/structured-errors.md)   |
| Wiring a framework, or installing          | [references/framework-setup.md](references/framework-setup.md)       |
| `init()` options, enrichers, PII, backends | [references/configuration.md](references/configuration.md)           |
| Processors, composition, pipelines         | [references/processor-pipeline.md](references/processor-pipeline.md) |
| AI / LLM calls                             | [references/ai-sdk.md](references/ai-sdk.md)                         |
| Asserting on instrumentation               | [references/testing.md](references/testing.md)                       |

## Anti-patterns to detect

The heart of the review. Each row is a grep-able smell with the replacement:

| Anti-pattern                                        | Fix                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `console.log` in handlers                           | Use `useLogger()`: fields land on the active span                  |
| Manual `tracer.startSpan` boilerplate               | `trace(fn)`: auto-named, auto-ended, auto-status                   |
| `try { … } catch (e) { console.error(e); throw e }` | Replace with `createStructuredError({ … })`                        |
| `throw new Error('something went wrong')`           | `createStructuredError({ message, status, why, fix })`             |
| Ad-hoc `span.setAttribute('user_id', id)`           | Use `useLogger().set({ user: { id } })`: flattens with stable keys |
| Multiple exporters wired in parallel by hand        | `composeSpanProcessors([…])`                                       |
| PII in attributes                                   | `attributeRedactor: 'default'` (on in prod by default)             |
| Cloudflare Workers without `waitUntil`              | Use `defineWorkerFetch` / `wrapModule`                             |
| High-cardinality span names (`/users/123`)          | `SpanNameNormalizingProcessor`                                     |
| AI SDK token logs                                   | `withAiTelemetry()` + gen-ai semantic conventions                  |
| Health checks blowing up trace volume               | `FilteringSpanProcessor`                                           |
| No tests for instrumentation                        | `InMemorySpanExporter` + `autotel-vitest` matchers                 |
| Manual context propagation in fetch                 | `instrumentation.instrumentGlobalFetch: true` (default)            |

Metrics nobody can alert on are the same class of problem one layer down — a
counter with no dimension to group by. Skill `design-alertable-metrics` covers
that review.

See [references/code-review.md](references/code-review.md) for the full checklist.

## Structured errors

Throw rich errors that carry status, audience, and remediation hints. And consume them at HTTP boundaries:

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

## Why autotel beats manually-wired OTel

Useful when the review turns into "why not just use the SDK directly":

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
