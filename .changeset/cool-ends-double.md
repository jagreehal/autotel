---
'autotel': major
---

Align with OpenTelemetry's Span Event API deprecation direction.

**Breaking (type-level)**

- `recordException` and `addEvent` are removed from the public `SpanMethods` /
  `TraceContext` type surface. The runtime methods remain bound for the
  deprecation window so existing call sites keep working and span-timeline
  views stay populated, but new code should not depend on them.

**New**

- `ctx.recordError(error)` — the ergonomic, ctx-bound replacement for the
  deprecated `ctx.recordException(error)`. Sets ERROR status, structured
  `error.*` attributes (including `why`/`fix`/`link` from
  `createStructuredError`), and during the back-compat window also routes
  through `recordException` so existing span-timeline views stay populated.
  Accepts `unknown` so it can be called directly with the value caught from a
  `catch` block — no `as Error` cast needed.
- `ctx.track(event, data?)` — the ergonomic, ctx-bound replacement for the
  deprecated `ctx.addEvent(name, attrs)`. Delegates to the standalone `track()`
  function (so events flow through the configured event subscribers and pick
  up trace context automatically). Use this from inside a `trace((ctx) => ...)`
  callback when you have a `ctx` handle in scope; the standalone `track()`
  remains available for code paths without a `ctx`.
- `recordStructuredError(ctx, error)` no longer requires `recordException` on
  the context — it feature-detects and gracefully degrades to span status only.
- Internal `emitCorrelatedEvent(ctx, name, attrs)` helper used by autotel's
  workflow, messaging, gen-ai, request logger, and webhook modules. Routes
  through `addEvent` while available; falls back to flat,
  sequence-prefixed attributes (`autotel.event.<n>.<name>.<key>`) so multiple
  events with the same name don't overwrite one another.
- Hybrid `trace` export: still callable as `trace(fn)` for autotel
  instrumentation, and now also carries the full `@opentelemetry/api`
  `TraceAPI` surface (`trace.getActiveSpan()`, `trace.getTracer()`,
  `trace.setSpan()`, …). Existing OTel code that does
  `import { trace } from 'autotel'` works without modification. The pure
  TraceAPI singleton remains available as `otelTrace`.
- Broadened native OTel re-exports from `autotel`:
  `Span`, `SpanContext`, `SpanAttributes`, `Tracer`, `TracerProvider`,
  `Context`, `Attributes`, `AttributeValue`, `Link`, `TimeInput`, `HrTime`,
  `Baggage`, `BaggageEntry`, `Exception`, `TraceFlags`, `TraceState`,
  `TextMapSetter`, `TextMapGetter`. Apps and plugins can drop the
  `@opentelemetry/api` direct dependency in most cases.
- `MIGRATION.md` documents the v3 transition: prefer the request logger and
  `recordStructuredError` for application code; `addEvent` /
  `recordException` are compatibility-only.

**Migration**

```ts
// Before
ctx.addEvent('checkout.payment_started', { method, amount });
ctx.recordException(error);

// After
ctx.track('checkout.payment_started', { method, amount });
ctx.recordError(error); // or recordStructuredError(ctx, error) outside trace()
```

Existing span-event data and backend views remain supported. Internal SDK glue
that operates on raw OTel `Span` objects (e.g. `span.recordException` inside
`functional.ts`) is unaffected — the deprecation targets the application-facing
API surface.
