# example-vitest

Vitest version of `example-playwright-e2e` demonstrating `autotel-vitest` test spans, reporter spans, and HTTP trace-context propagation.

## Features covered

1. `autotel-vitest` fixture: one parent span per test
2. `autotel-vitest/reporter`: runner-side test/suite spans
3. HTTP route coverage: `/health`, `/users/:id`, `/users` (POST), `/error`, 404
4. Explicit trace header propagation with `injectTraceContext` from `autotel/http`
5. Failure path: test assertion failure captured as an error on the test span

## OTel captured

| Source | Spans | When |
|--------|--------|------|
| **autotel-vitest fixture** | One span per test (`test:<test name>`). Attributes: `test.name`, `test.file`, `test.suite`. On assertion failure: span status ERROR and `recordException`. | Every test run; spans are in the test process (AsyncLocalStorage). |
| **autotel-vitest/reporter** | One span per test and one per suite (`suite:<describe name>`). Attributes: `test.name` / `suite.name`, `test.fullName`, `test.file`. Emitted by the Vitest runner process. | Every test run; reporter prints span payloads to stdout when no OTLP exporter is configured. |
| **Server (separate process)** | One HTTP span per request (`GET /health`, etc.) plus any child spans (e.g. `fetchUser` for GET `/users/:id`). | Only when the test sends `traceparent` (e.g. via `injectTraceContext()`). Then server `extractTraceContext()` continues the same trace, so you get **test → HTTP request → server spans** in one trace. |
| **Tests without injectTraceContext** | Test span only (and reporter span). Server still creates spans but in a new trace (no link to the test). | Tests that call `fetch()` without trace headers. |

So for a **single trace** from test to server: use `injectTraceContext()` in the test and ensure the server is instrumented with autotel and `extractTraceContext()` (as in `server.mjs`).

## Architecture

- `server.mjs`: self-contained Node HTTP server instrumented with `autotel`
- `globalSetup.ts`: calls `autotel.init()` for test process + reporter process
- `vitest.config.ts`: enables reporter and global setup
- `tests/specs/api.spec.ts`: integration tests that start the server and exercise all routes

## Run tests

From this directory:

```bash
pnpm test
```

Use `API_BASE_URL` (default `http://localhost:3000`) and `OTLP_ENDPOINT` as needed.
