# Testing your instrumentation

Instrumentation that nothing asserts on rots as quietly as untested code.

## Unit tests (trace collector)

`createTraceCollector()` from `autotel/testing` points autotel's tracer at an
in-memory collector. No `init()` needed. Create one per test (`beforeEach`).

```typescript
import { trace, getRequestLogger } from 'autotel';
import { createTraceCollector, assertTraceSucceeded } from 'autotel/testing';

const processOrder = trace('processOrder', async (orderId: string) => {
  getRequestLogger().set({ order: { id: orderId } });
});

it('traces processOrder', async () => {
  const collector = createTraceCollector();
  await processOrder('123');

  assertTraceSucceeded(collector, 'processOrder');
  const span = collector.expectSpan({
    name: 'processOrder',
    attributes: { 'order.id': '123' },
  });
  expect(span.status.code).toBe(1); // SpanStatusCode.OK
});
```

Collector methods: `getSpans()`, `getSpansByName()`, `getSpansByAttributes()`, `expectSpan()` (exactly one match or throws), `clear()`. Assertions: `assertTraceCreated`, `assertTraceSucceeded`, `assertTraceFailed`, `assertNoErrors`, and `await waitForTrace(collector, name)` for async work.

To test the real SDK pipeline (processors, redaction) instead, pass `spanProcessors: [new SimpleSpanProcessor(exporter)]` with `InMemorySpanExporter` from `autotel/exporters` and `sampling: 'development'` to `init()`, then read `exporter.getFinishedSpans()` before `shutdown()`.

`autotel-vitest` gives every test its own parent span: import `test` from `autotel-vitest` and pass `otelTestCollector` to `init()` in a `setupFiles` entry. It re-exports the `autotel/testing` helpers; there are no custom matchers.

## End-to-end (real OTLP backend)

autotel's own `packages/autotel/test/e2e/` is a working OTLP HTTP/JSON smoke test that tags every span with `e2e_run_id` / `e2e_correlation_id` for cleanup, skips gracefully when env vars are missing, and runs on a daily GitHub Actions cron. Copy it to test against your own backend (Honeycomb, Grafana Cloud, Datadog, …). In the autotel repo:

```bash
pnpm --filter autotel run test:e2e
```
