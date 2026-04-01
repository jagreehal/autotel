---
name: autotel-playwright
description: >
  Playwright fixture and reporter that create one OTel span per test and inject W3C trace context into API requests, linking e2e tests to server-side traces.
type: integration
library: autotel-playwright
library_version: "0.4.10"
sources:
  - jagreehal/autotel:packages/autotel-playwright/src/index.ts
  - jagreehal/autotel:packages/autotel-playwright/src/reporter.ts
---

# autotel-playwright

Playwright fixture that creates one OTel span per e2e test and propagates W3C trace context (`traceparent`) into API requests. Use it when you want test runs and server-side spans to appear as a single connected trace in your observability backend.

Two independent features ship in this package:

- **Test fixture** (`autotel-playwright`) — worker-side; spans follow each test, headers are injected per request.
- **OTel Reporter** (`autotel-playwright/reporter`) — runner-side; creates spans for tests and steps from the Playwright runner process.

## Setup

### 1. Global setup

```ts
// globalSetup.ts
import { createGlobalSetup } from 'autotel-playwright';

export default createGlobalSetup({
  service: 'e2e-tests',
  // any autotel init options
});
```

### 2. Playwright config

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: './globalSetup.ts',
  // Optional: runner-side span reporter
  reporter: [['list'], ['autotel-playwright/reporter']],
  use: {
    baseURL: 'http://localhost:3000',
  },
});
```

Set env vars so trace headers are injected only to your API:

```bash
API_BASE_URL=http://localhost:3000/api
# or for a non-/api origin:
AUTOTEL_PLAYWRIGHT_API_ORIGIN=http://localhost:3000
```

### 3. Tests

```ts
// Replace @playwright/test with autotel-playwright
import { test, expect } from 'autotel-playwright';

test('checks health', async ({ page }) => {
  // page requests to API_BASE_URL automatically get traceparent headers
  await page.goto('http://localhost:3000/health');
  await expect(page).toHaveTitle(/Health/);
});

test('api health', async ({ requestWithTrace }) => {
  // requestWithTrace injects traceparent on matching URLs
  const res = await requestWithTrace.get('http://localhost:3000/api/health');
  expect(res.ok()).toBeTruthy();
});
```

## Configuration / Core Patterns

### Fixtures

| Fixture | Type | Description |
|---|---|---|
| `page` | `Page` | Standard Playwright `Page`; auto-injects trace headers for routes matching `API_BASE_URL` |
| `requestWithTrace` | `APIRequestContext` | Wraps `request`; injects `traceparent` + `x-test-name` on all matching URLs |
| `_otelTestSpan` | internal | Creates and manages the root test span; do not use directly |

### Named steps as child spans

Use `step()` to create child spans under the test span for granular timing:

```ts
import { test, step, expect } from 'autotel-playwright';

test('user flow', async ({ page }) => {
  await step('login', async () => {
    await page.fill('[name=email]', 'user@example.com');
    await page.click('button[type=submit]');
  });

  await step('navigate to dashboard', async () => {
    await page.goto('/dashboard');
  });
});
```

### Custom span attributes via annotations

Add arbitrary attributes to the test span without touching the span directly:

```ts
test('tagged test', async ({ page }) => {
  test.info().annotations.push({
    type: 'autotel.attribute',
    description: 'feature=checkout;env=staging',
  });
  // attributes are set on the root test span
});
```

Multiple key=value pairs are separated by `;`. The format is `key=value;key2=value2`.

### Server-side span assertions with `createTestSpansClient`

Pairs with `createTestSpansHandlers()` from `autotel-tanstack/testing` to assert what spans the server actually created:

```ts
import { test, createTestSpansClient, expect } from 'autotel-playwright';

const spansClient = createTestSpansClient('http://localhost:3100');

test('server function is traced', async ({ page, request }) => {
  await spansClient.clearSpans(request);

  await page.goto('/');
  await page.click('button#send');

  const spans = await spansClient.getSpans(request);
  expect(spans.find(s => s.name === 'sendMoney.handler')).toBeDefined();
});
```

### OTel Reporter (runner-side)

The reporter at `autotel-playwright/reporter` creates spans in the runner process — useful when you want test hierarchy in OTLP from outside the worker:

```ts
// playwright.config.ts
reporter: [['list'], ['autotel-playwright/reporter']],
```

This is separate from the fixture. Both can be used together: fixture spans flow through the worker; reporter spans flow from the runner. They are independent traces.

### Trace context helpers

```ts
import { getTraceContext, resolveTraceUrl, isTracing } from 'autotel-playwright';

test('logs trace link', async ({ page }) => {
  if (isTracing()) {
    const ctx = getTraceContext();
    console.log('Trace:', resolveTraceUrl(ctx));
  }
});
```

## Common Mistakes

### HIGH: Not calling `createGlobalSetup` (or `init()`) in globalSetup

Without `init()`, no spans are exported — the fixture creates spans but they are never sent to the backend.

Wrong:
```ts
// playwright.config.ts — no globalSetup
export default defineConfig({ ... });
```

Correct:
```ts
// globalSetup.ts
import { createGlobalSetup } from 'autotel-playwright';
export default createGlobalSetup({ service: 'e2e-tests' });

// playwright.config.ts
export default defineConfig({ globalSetup: './globalSetup.ts', ... });
```

### HIGH: Importing from `@playwright/test` instead of `autotel-playwright`

The fixtures (`requestWithTrace`, trace-aware `page`) only exist on the extended `test` object.

Wrong:
```ts
import { test, expect } from '@playwright/test';
// requestWithTrace fixture is not available
```

Correct:
```ts
import { test, expect } from 'autotel-playwright';
```

### MEDIUM: Setting `API_BASE_URL` with a trailing slash

The package strips trailing slashes internally, but path-prefix matching only works if the env var is set correctly. Setting `API_BASE_URL=http://localhost:3000/api/` is fine, but setting `API_BASE_URL=http://localhost:3000` will inject trace headers on ALL requests to that origin, including unrelated paths like `/static/`.

Use a path-scoped URL when you only want a subset of routes to receive headers:
```bash
API_BASE_URL=http://localhost:3000/api
```

### MEDIUM: Confusing the fixture `page` with the reporter

The fixture injects headers in the worker process per-test. The reporter creates spans in the runner process. They do not share span context — they produce separate traces. Use the fixture for test-to-API tracing; use the reporter for standalone test timing in OTLP.

### MEDIUM: Using `step()` outside a test span context

`step()` creates child spans under the current active OTel span. If called outside a test that uses the autotel-playwright `test` fixture (e.g., in a `beforeAll` without a running span), the step span will be a root span, not a child.

## Version

Targets autotel-playwright v0.4.10. Peer dependency: `@playwright/test >=1.58.2`.
