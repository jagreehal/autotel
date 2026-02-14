# example-playwright-e2e

Kitchen-sink Playwright project demonstrating every **autotel-playwright** feature: fixture (`page` + `requestWithTrace`), `step()` helper, and `OtelReporter`.

## Features covered

1. **page.goto** - trace context injected into browser requests via `page.route`
2. **requestWithTrace.get/post** - Node-side API calls with trace headers
3. **step()** - child spans within a test (success + failure with error recording)
4. **test.step()** - Playwright native steps triggering OtelReporter spans
5. **Error/404 routes** - trace context flows on non-happy paths

## Architecture

- **server.mjs** - Self-contained Node.js HTTP server with autotel (`/health`, `/users/:id`, `/users` POST, `/error`)
- **globalSetup.ts** - Calls `autotel.init()` so the reporter (runner process) exports test/step spans
- **playwright.config.ts** - `webServer` starts `server.mjs`; `OtelReporter` via `['autotel-playwright/reporter']`
- **tests/specs/api.spec.ts** - 11 tests covering all features above

## Run tests

From this directory:

```bash
pnpm test
```

Set `API_BASE_URL` (default `http://localhost:3000`) if needed.
