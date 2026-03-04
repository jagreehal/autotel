# autotel-vitest

## 0.3.2

### Patch Changes

- Updated dependencies [eb28f60]
- Updated dependencies [f772504]
  - autotel@2.23.0

## 0.3.1

### Patch Changes

- Updated dependencies [1155c72]
  - autotel@2.22.0

## 0.3.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

### Patch Changes

- Updated dependencies [c710c71]
  - autotel@2.21.0

## 0.2.0

### Minor Changes

- 6b67787: - **autotel**: Export `getTraceContext`, `isTracing`, `enrichWithTraceContext`, and `resolveTraceUrl` from trace-helpers; export `OtelTraceContext` type; add `resolveTraceUrl(template, traceId)` for trace URL templates (supports `OTEL_TRACE_URL_TEMPLATE` env var); add `autotel/test-span-collector` entry point.
  - **autotel-playwright**: New package. Playwright fixture: one OTel span per test, injects W3C trace context into `page` and `requestWithTrace` for requests to your API; `step()` helper for child spans; optional `autotel-playwright/reporter` for runner-side spans.
  - **autotel-vitest**: New package. Vitest fixture: one OTel span per test so instrumented code under test appears as child spans; optional reporter for suite/test spans; re-exports autotel/testing utilities.

### Patch Changes

- Updated dependencies [6b67787]
  - autotel@2.20.0
