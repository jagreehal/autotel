# Changelog

## 0.4.14

### Patch Changes

- Updated dependencies [abe7674]
  - autotel@2.26.2

## 0.4.13

### Patch Changes

- Updated dependencies [dc471ef]
  - autotel@2.26.1

## 0.4.12

### Patch Changes

- 8003fad: feat: migrate autotel-devtools into monorepo and upgrade to TypeScript 6.0
  - migrate `autotel-devtools` (standalone OTLP receiver + Preact web UI) into the monorepo with tsup server build and Vite IIFE widget build
  - add `devtools` support to `autotel.init()` for local `autotel-devtools` usage, including optional embedded startup and shutdown cleanup
  - improve `autotel-web` browser span export behavior by avoiding exporter recursion, feature-detecting `sendBeacon`, and reading HTTP methods from `Request` objects
  - narrow the `autotel-edge` factory marker fix to source code so downstream bundlers do not misoptimize required initializers
  - upgrade all packages to TypeScript 6.0: add `tsconfig.build.json` with `ignoreDeprecations: "6.0"` for tsup DTS generation, add explicit `"types": ["node"]` where missing, set `rootDir` where needed
  - fix Astro docs content collection config for Starlight loader API change
  - fix Playwright version mismatch between autotel-playwright and example-playwright-e2e
  - add `@tanstack/intent` to autotel runtime dependencies (required by published bin)

- Updated dependencies [8003fad]
  - autotel@2.26.0

## 0.4.11

### Patch Changes

- Updated dependencies [f4ac1c3]
  - autotel@2.25.5

## 0.4.10

### Patch Changes

- 2a36104: Add E2E test mode to `auto.ts`: when `E2E=1`, initializes with `InMemorySpanExporter` instead of OTLP and sets `globalThis.__testSpanExporter` for HTTP inspection. Add `createTestSpansHandlers()` and `SerializedSpan` to `autotel-tanstack/testing` for building a zero-boilerplate test-spans HTTP endpoint in Playwright E2E setups.

## 0.4.9

### Patch Changes

- Updated dependencies [32e088f]
  - autotel@2.25.4

## 0.4.8

### Patch Changes

- Updated dependencies [3a5b723]
  - autotel@2.25.3

## 0.4.7

### Patch Changes

- 7d77567: Add opt-in OTLP log export and improve terminal UX.

  **autotel**
  - Add `logs: true` option to `init()` that auto-configures `BatchLogRecordProcessor` + `OTLPLogExporter` from the endpoint — no manual imports needed. Defaults to `false` (opt-in) to preserve existing behavior and upstream `OTEL_LOGS_EXPORTER` handling.
  - Add `resolveLogsFlag()` with `AUTOTEL_LOGS` env var override, matching the `metrics` pattern.
  - Move `@opentelemetry/exporter-logs-otlp-http` and `@opentelemetry/sdk-logs` from optional peer deps to regular dependencies.
  - Export `RedactingLogRecordProcessor` from `posthog-logs.ts` for reuse by the auto-configured log pipeline.

  **autotel-terminal**
  - AI panel: show configuration guidance when no provider is detected; only enter input mode when a provider is available.
  - AI panel: Escape now closes the panel entirely (not just exits input mode).
  - Add `f` key for typeable traceId filter with Tab autocomplete against known trace IDs.
  - Add Tab-to-traceId autocomplete in `/` search mode (4+ character prefix match).
  - Add Escape to exit search mode (in addition to existing `/` toggle and Enter).

- Updated dependencies [7d77567]
  - autotel@2.25.2

## 0.4.6

### Patch Changes

- Updated dependencies [c6010e1]
  - autotel@2.25.1

## 0.4.5

### Patch Changes

- Updated dependencies [04c370a]
  - autotel@2.25.0

## 0.4.4

### Patch Changes

- Updated dependencies [3438fe4]
  - autotel@2.24.1

## 0.4.3

### Patch Changes

- Updated dependencies [88b4eab]
- Updated dependencies [88b4eab]
  - autotel@2.24.0

## 0.4.2

### Patch Changes

- Updated dependencies [65b2fc9]
  - autotel@2.23.1

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
