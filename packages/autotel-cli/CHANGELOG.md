# autotel-cli

## 0.4.0

### Minor Changes

- 8a6769a: x

## 0.3.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

## 0.2.0

### Minor Changes

- 78202aa: Add logger instrumentation validation to `autotel doctor` command and update documentation for Winston/Bunyan setup.

  **autotel-cli:**
  - Add logger instrumentation check to `autotel doctor` that validates Winston, Bunyan, and Pino instrumentation packages are installed when configured
  - Parse source code to detect `autoInstrumentations` configuration and warn if instrumentation packages are missing
  - Add `logger-checker` utility to extract and validate logger instrumentation setup

  **autotel:**
  - Update README to clarify that Winston and Bunyan instrumentation packages must be installed separately, even though they're included in `@opentelemetry/auto-instrumentations-node`
  - Fix misleading "auto-detects" claims - all loggers require explicit `autoInstrumentations` configuration
  - Update Pino, Winston, and Bunyan examples to show correct setup with `autoInstrumentations` array

## 0.1.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.
