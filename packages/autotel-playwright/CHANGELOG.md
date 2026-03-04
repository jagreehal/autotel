# Changelog

## 0.4.1

### Patch Changes

- Updated dependencies [eb28f60]
- Updated dependencies [f772504]
  - autotel@2.23.0

## 0.4.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

### Patch Changes

- Updated dependencies [1155c72]
  - autotel@2.22.0

## 0.3.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

### Patch Changes

- Updated dependencies [c710c71]
  - autotel@2.21.0

## 0.2.1

### Patch Changes

- e57aacb: - Run test body and propagation.inject inside the test span context so trace context is active and W3C headers are correct.
  - On test failure, mark the test span as error and record the exception before rethrowing.
  - Add tests for error recording and context propagation.

## 0.2.0

### Minor Changes

- 6b67787: - **autotel**: Export `getTraceContext`, `isTracing`, `enrichWithTraceContext`, and `resolveTraceUrl` from trace-helpers; export `OtelTraceContext` type; add `resolveTraceUrl(template, traceId)` for trace URL templates (supports `OTEL_TRACE_URL_TEMPLATE` env var); add `autotel/test-span-collector` entry point.
  - **autotel-playwright**: New package. Playwright fixture: one OTel span per test, injects W3C trace context into `page` and `requestWithTrace` for requests to your API; `step()` helper for child spans; optional `autotel-playwright/reporter` for runner-side spans.
  - **autotel-vitest**: New package. Vitest fixture: one OTel span per test so instrumented code under test appears as child spans; optional reporter for suite/test spans; re-exports autotel/testing utilities.

### Patch Changes

- Updated dependencies [6b67787]
  - autotel@2.20.0

## 0.1.0

- Initial release: Playwright fixture that creates one OTel span per test and injects W3C trace context into requests matching `API_BASE_URL` / `AUTOTEL_PLAYWRIGHT_API_ORIGIN`. Exports `test`, `expect`, `createGlobalSetup`, and `AUTOTEL_ATTRIBUTE_ANNOTATION`.

## Unreleased

- **requestWithTrace** fixture: optional fixture that wraps the built-in `request` (APIRequestContext). Requests made with `requestWithTrace.get()`, `.post()`, etc. to URLs matching the API base get trace context and `x-test-name` injected, so Node-side API calls from tests attach to the same test span.
- **step(name, fn)** helper: runs an async function as a named step and creates a child span (`step:${name}`) under the test span for step-level granularity in the same trace.
- **OtelReporter** (`autotel-playwright/reporter`): optional Playwright reporter that creates one span per test and one per step (as children) in the runner process. Use with `reporter: [['list'], [OtelReporter]]` and ensure `init()` is called in globalSetup.
