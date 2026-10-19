---
name: autotel-vitest
description: >
  Use this skill when adding OpenTelemetry tracing to Vitest tests — gives each test a parent span so all instrumented code becomes filterable child spans in your OTLP backend.
---

# autotel-vitest

Vitest fixture that creates one OTel span per test so all `autotel`-instrumented code executed during a test automatically runs as child spans. Makes every test run filterable by trace ID in your OTLP backend (Jaeger, Honeycomb, Datadog, etc.).

## Setup

### 1. Install

```bash
pnpm add autotel autotel-vitest
pnpm add -D vitest
```

### 2. vitest.setup.ts: call init() in a setup file

```typescript
// vitest.setup.ts
import { init } from 'autotel';
import { SimpleSpanProcessor, BatchSpanProcessor } from 'autotel/processors';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { otelTestCollector } from 'autotel-vitest';

init({
  service: 'unit-tests',
  spanProcessors: [
    new SimpleSpanProcessor(otelTestCollector),
    // Optional: also ship test traces to a collector
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
    ),
  ],
});
```

`spanProcessors` replaces the pipeline autotel would build from `endpoint`, so `endpoint` is ignored here; add an OTLP processor yourself (install `@opentelemetry/exporter-trace-otlp-http`) if you want the spans in a backend.

- **`setupFiles`, not `globalSetup`.** The fixture creates spans in the worker that runs the test. `globalSetup` runs in the main process, whose module state workers do not share.
- **Pass `otelTestCollector` to `init()`.** OpenTelemetry SDK 2.x removed `addSpanProcessor`, so the collector the fixture drains after each test has to be registered when the provider is built.

### 3. vitest.config.ts: register the setup file

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

### 4. Import test from autotel-vitest

```typescript
import { test, expect } from 'autotel-vitest';

test('creates user', async () => {
  await userService.createUser({ email: 'test@example.com' });
  // All trace()/span() calls in userService become child spans of this test
  expect(true).toBe(true);
});
```

The fixture is `auto: true`. Every test gets a parent span automatically with no extra code.

## Configuration / Core Patterns

### Per-test span attributes

Each test span is named `test:${task.name}` and carries these attributes automatically:

- `test.name`: the test name string
- `test.file`: file path from `task.file.name`
- `test.suite`: suite name from `task.suite.name` (if in a describe block)

If a test throws, the span is marked `ERROR` and records the exception.

After each test the fixture flushes, drains that test's spans from `otelTestCollector`, and stores them on `task.meta.otelSpans` (rendered by executable-stories as a waterfall). Reading spans inside the test body? `await flush()` first; export is asynchronous.

### Finding the trace from a test run

Every test is annotated with type `otel-trace`, carrying the trace URL resolved
from `OTEL_TRACE_URL_TEMPLATE` or the raw trace id, so a reporter — the HTML
report, the browser trace view's step list — links back to the trace for that
test.

In browser mode, a recorded Playwright trace reaches reporters as an annotation
attachment; the OtelReporter copies its path onto the test span as
`test.trace.path`, so a failed span leads to the replay:

```bash
npx playwright show-trace <test.trace.path>
```

### Optional: OtelReporter (runner-process spans)

The fixture creates spans in the **worker** process. If you also want **runner-process** spans for test/suite timing, add the reporter (`OtelReporter`, the default export of `autotel-vitest/reporter`):

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'], // worker: fixture spans
    globalSetup: './globalSetup.ts', // main process: init() for the reporter
    reporters: ['default', 'autotel-vitest/reporter'],
  },
});
```

The reporter runs in the main process, so `init()` in `setupFiles` does not reach it; it needs its own `init()` there (a `globalSetup` file is the usual place):

```typescript
// globalSetup.ts
import { init, shutdown } from 'autotel';

export default function setup() {
  init({ service: 'unit-tests-runner', endpoint: 'http://localhost:4318' });
  return async () => {
    await shutdown(); // flush reporter spans before exit
  };
}
```

Reporter creates:

- `test:<name>` spans for each test case
- `suite:<name>` spans for each describe block

Each reporter span is its own root (test spans are not children of suite spans), with a different trace ID from the fixture's worker-side test span.

### Testing utilities (re-exported from autotel/testing)

```typescript
import {
  test,
  createTraceCollector,
  assertTraceCreated,
  assertTraceSucceeded,
  assertTraceFailed,
  assertNoErrors,
  assertTraceDuration,
  waitForTrace,
  getTraceDuration,
  createMockLogger,
} from 'autotel-vitest';

test('traces user creation', async () => {
  const collector = createTraceCollector();
  await userService.createUser({ email: 'test@example.com' });
  assertTraceCreated(collector, 'user.createUser');
  assertTraceSucceeded(collector, 'user.createUser');
});
```

`createTraceCollector()` registers the W3C trace-context and baggage propagator unless the test set its own, so `propagation.inject`/`extract` work without `init()`.

### Trace context helpers (re-exported from autotel)

```typescript
import {
  getTraceContext,
  resolveTraceUrl,
  isTracing,
  enrichWithTraceContext,
} from 'autotel-vitest';
```

### Cross-process tracing (test → HTTP server)

When the server runs in a separate process, inject the trace context into the HTTP request so both sides share the same trace ID:

```typescript
import { test } from 'autotel-vitest';
import { injectTraceContext, extractTraceContext } from 'autotel/http';

test('traces across HTTP', async () => {
  const response = await fetch('http://localhost:3000/api/users', {
    headers: injectTraceContext(), // adds traceparent header
  });
  // Server must call extractTraceContext(req.headers) and run in that context
  // Both test span and server spans appear under the same trace ID in OTLP
});
```

## Common Mistakes

### HIGH: Importing test from vitest instead of autotel-vitest

Wrong:

```typescript
import { test } from 'vitest'; // base test — no OTel fixture

test('creates user', async () => {
  await userService.createUser({ email: 'test@example.com' });
  // No parent span — instrumented code spans are unlinked orphans
});
```

Correct:

```typescript
import { test } from 'autotel-vitest'; // extended test with auto fixture
```

Explanation: Only the extended `test` from `autotel-vitest` has the `_otelTestSpan` fixture registered. Using the base `vitest` `test` means no parent context is active and child spans appear as disconnected traces.

### HIGH: Calling init() in globalSetup for the fixture

Wrong:

```typescript
// vitest.config.ts
export default defineConfig({
  test: { globalSetup: './globalSetup.ts' }, // init() runs in the main process only
});
```

Correct:

```typescript
// vitest.config.ts
export default defineConfig({
  test: { setupFiles: ['./vitest.setup.ts'] }, // init() runs in every worker
});
```

Explanation: test bodies and the fixture run in worker processes. A provider configured in `globalSetup` lives in the main process, so worker spans are never exported. Also pass `new SimpleSpanProcessor(otelTestCollector)` in `spanProcessors`, or `task.meta.otelSpans` stays empty on SDK 2.x.

### MEDIUM: Adding the reporter without init() in the main process

Wrong:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'], // workers only
    reporters: ['default', 'autotel-vitest/reporter'],
  },
});
```

Correct: also add a `globalSetup` that calls `init()` (see the reporter section).

Explanation: The reporter runs in the Vitest main process and calls `getTracer()`. If `init()` was never called there, there is no configured tracer provider and its spans silently go nowhere.

### MEDIUM: Calling describe/beforeEach from vitest directly when using autotel-vitest

These are safe to mix. `autotel-vitest` re-exports `describe`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll` directly from `vitest`, so you can import everything from one place:

```typescript
import { test, expect, describe, beforeEach } from 'autotel-vitest';
```

## Version

Targets autotel-vitest v0.4.71. Requires `vitest >=5.0.4` (peer). `autotel` is a regular dependency; install it directly too since you import `init` from it. There are no custom matchers: the API is the `test` fixture, `otelTestCollector`, the `autotel/testing` re-exports, and `autotel-vitest/reporter`.
