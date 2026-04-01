---
name: autotel-vitest
description: >
  Use this skill when adding OpenTelemetry tracing to Vitest tests — gives each test a parent span so all instrumented code becomes filterable child spans in your OTLP backend.
type: integration
library: autotel-vitest
library_version: "0.4.4"
sources:
  - jagreehal/autotel:packages/autotel-vitest/src/index.ts
  - jagreehal/autotel:packages/autotel-vitest/src/fixture.ts
  - jagreehal/autotel:packages/autotel-vitest/src/reporter.ts
---

# autotel-vitest

Vitest fixture that creates one OTel span per test so all `autotel`-instrumented code executed during a test automatically runs as child spans. Makes every test run filterable by trace ID in your OTLP backend (Jaeger, Honeycomb, Datadog, etc.).

## Setup

### 1. Install

```bash
pnpm add autotel autotel-vitest
pnpm add -D vitest
```

### 2. globalSetup.ts — call init() before tests run

```typescript
// globalSetup.ts
import { init } from 'autotel';

export default function globalSetup() {
  init({
    service: 'unit-tests',
    endpoint: 'http://localhost:4318',  // Your OTLP collector
  });
}
```

### 3. vitest.config.ts — register globalSetup

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './globalSetup.ts',
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

The fixture is `auto: true` — every test gets a parent span automatically with no extra code.

## Configuration / Core Patterns

### Per-test span attributes

Each test span is named `test:${task.name}` and carries these attributes automatically:

- `test.name` — the test name string
- `test.file` — file path from `task.file.name`
- `test.suite` — suite name from `task.suite.name` (if in a describe block)

If a test throws, the span is marked `ERROR` and records the exception.

### Optional: OtelReporter (runner-process spans)

The fixture creates spans in the **worker** process. If you also want **runner-process** spans for test/suite timing (visible in your OTLP backend as a hierarchy), add the reporter:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './globalSetup.ts',
    reporters: ['default', 'autotel-vitest/reporter'],
  },
});
```

Reporter creates:
- `test:<name>` spans for each test case
- `suite:<name>` spans for each describe block

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

### Trace context helpers (re-exported from autotel)

```typescript
import { getTraceContext, resolveTraceUrl, isTracing, enrichWithTraceContext } from 'autotel-vitest';
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

### HIGH — Importing test from vitest instead of autotel-vitest

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

### HIGH — Not calling init() in globalSetup

Wrong:
```typescript
// vitest.config.ts — no globalSetup
// Spans are created but never exported (no tracer provider configured)
```

Correct:
```typescript
// globalSetup.ts
import { init } from 'autotel';
export default function globalSetup() {
  init({ service: 'unit-tests', endpoint: 'http://localhost:4318' });
}
```

Explanation: `init()` must run in `globalSetup` (not in a `beforeAll` or test file) so the provider is available before any worker process starts executing tests.

### MEDIUM — Adding the reporter without globalSetup

Wrong:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    reporters: ['default', 'autotel-vitest/reporter'],
    // No globalSetup — init() never called in the runner process
  },
});
```

Correct: Always pair the reporter with `globalSetup` that calls `init()`.

Explanation: The reporter runs in the Vitest runner process and calls `getTracer()`. If `init()` was never called, there is no configured tracer provider and spans silently go nowhere.

### MEDIUM — Calling describe/beforeEach from vitest directly when using autotel-vitest

These are safe to mix — `autotel-vitest` re-exports `describe`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll` directly from `vitest`, so you can import everything from one place:

```typescript
import { test, expect, describe, beforeEach } from 'autotel-vitest';
```

## Version

Targets autotel-vitest v0.4.4. Requires `vitest >=4.1.0` (peer), `autotel` (peer). The fixture uses `auto: true` (Vitest 4+ fixture API).
