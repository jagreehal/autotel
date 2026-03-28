# autotel-docs

## 0.0.2

### Patch Changes

- 2a36104: Add E2E test mode to `auto.ts`: when `E2E=1`, initializes with `InMemorySpanExporter` instead of OTLP and sets `globalThis.__testSpanExporter` for HTTP inspection. Add `createTestSpansHandlers()` and `SerializedSpan` to `autotel-tanstack/testing` for building a zero-boilerplate test-spans HTTP endpoint in Playwright E2E setups.
