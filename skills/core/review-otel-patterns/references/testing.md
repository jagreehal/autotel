# Testing your instrumentation

Instrumentation that nothing asserts on rots as quietly as untested code.

## Unit tests (in-memory exporter)

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

## End-to-end (real OTLP backend)

`packages/autotel/test/e2e/` ships a working OTLP HTTP/JSON smoke test that tags every span with `e2e_run_id` / `e2e_correlation_id` for cleanup, skips gracefully when env vars are missing, and is wired up to a daily GitHub Actions cron. Copy it to test against your own backend (Honeycomb, Grafana Cloud, Datadog, …):

```bash
pnpm --filter autotel run test:e2e
```

## Bundle size guard

`scripts/check-bundle-size.mjs` measures every `packages/autotel*/dist` against `bundle-size-baseline.json` and fails CI on growth past 5 % / 2 KiB. Update the baseline only when the growth is intentional.
