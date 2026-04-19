# autotel-terminal

## 18.0.2

### Patch Changes

- Updated dependencies [abe7674]
  - autotel@2.26.2

## 18.0.1

### Patch Changes

- Updated dependencies [dc471ef]
  - autotel@2.26.1

## 18.0.0

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

## 17.0.9

### Patch Changes

- Updated dependencies [f4ac1c3]
  - autotel@2.25.5

## 17.0.8

### Patch Changes

- Updated dependencies [32e088f]
  - autotel@2.25.4

## 17.0.7

### Patch Changes

- 3a5b723: Added sampling options
- Updated dependencies [3a5b723]
  - autotel@2.25.3

## 17.0.6

### Patch Changes

- ca63151: Add JSON Render

## 17.0.5

### Patch Changes

- 23113bc: Updated terminal UI

## 17.0.4

### Patch Changes

- 4dd52c4: UI Enhancements

## 17.0.3

### Patch Changes

- e3f927c: Updated ui

## 17.0.2

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

## 17.0.1

### Patch Changes

- c6010e1: Improve package compatibility and tooling consistency across the monorepo.
  - Add CommonJS build output/exports where missing (including `autotel` entrypoints and backend/MCP package builds) to improve `require()` interoperability.
  - Roll forward shared dependency versions across affected packages/apps to keep examples and libraries aligned on the same toolchain.

- Updated dependencies [c6010e1]
  - autotel@2.25.1

## 17.0.0

### Minor Changes

- 04c370a: This release rolls out a monorepo-wide refresh across the Autotel package family with coordinated minor updates.

  Highlights:
  - Align package internals and workspace metadata for the next release wave.
  - Improve reliability of test and quality workflows used across packages.
  - Keep package behavior and public APIs consistent while shipping incremental enhancements across the ecosystem.

### Patch Changes

- Updated dependencies [04c370a]
  - autotel@2.25.0

## 16.0.1

### Patch Changes

- 3438fe4: Fix snapshot recording mode and keyboard navigation
  - Fix stale closure: add `recording` to useEffect dependency arrays for log and span listeners so snapshot mode actually activates
  - Fix unreachable auto-stop: check record limit before truncating to maxSpans so recording auto-pauses at 200 events
  - Fix keyboard navigation: add arrow-key handling for service-summary and errors views

- Updated dependencies [3438fe4]
  - autotel@2.24.1

## 16.0.0

### Patch Changes

- Updated dependencies [88b4eab]
- Updated dependencies [88b4eab]
  - autotel@2.24.0

## 15.0.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.
- Updated dependencies [65b2fc9]
  - autotel@2.23.1

## 15.0.0

### Patch Changes

- Updated dependencies [eb28f60]
- Updated dependencies [f772504]
  - autotel@2.23.0

## 14.0.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

### Patch Changes

- Updated dependencies [1155c72]
  - autotel@2.22.0

## 13.0.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

### Patch Changes

- Updated dependencies [c710c71]
  - autotel@2.21.0

## 12.0.0

### Patch Changes

- Updated dependencies [6b67787]
  - autotel@2.20.0

## 11.0.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

### Patch Changes

- Updated dependencies [d1bd8cd]
  - autotel@2.19.0

## 10.0.1

### Patch Changes

- ecf920e: Add OpenTelemetry MCP semantic conventions and operation duration metrics.

  **autotel-mcp**
  - New subpath export `autotel-mcp/semantic-conventions`: `MCP_SEMCONV`, `MCP_METHODS`, `MCP_METRICS`, `MCP_DURATION_BUCKETS` per [OTel MCP semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/).
  - New subpath export `autotel-mcp/metrics`: `recordClientOperationDuration`, `recordServerOperationDuration` for client/server operation duration histograms.
  - Server and client instrumentation updated to use the semantic conventions for span attributes and to record operation duration metrics.

  **Example apps** (`example-mcp-client`, `example-mcp-server`, `awaitly-example`) updated to use the new conventions and metrics.

  **Dependency updates** (from npm-check-updates)
  - ESLint: `@eslint/js` 10.0.1, `eslint` 10.0.0.
  - `dotenv` 17.2.4.
  - `@types/node` 25.2.2 across multiple packages.
  - `@aws-sdk` clients, `mongoose`, `@modelcontextprotocol/sdk` updated for compatibility and latest features.
  - Peer dependencies adjusted in `autotel-cloudflare` and `autotel-mcp` to match latest versions.

- Updated dependencies [ecf920e]
  - autotel@2.18.1

## 10.0.0

### Minor Changes

- 23ed022: - **autotel-plugins**: Add BigQuery and Kafka plugins.
  - **BigQuery**: OpenTelemetry instrumentation for `@google-cloud/bigquery` (query, insert, load, copy, extract, job tracking; optional query sanitization and GCP semantic attributes). No official OTel support; optional peer dependency.
  - **Kafka**: Composition layer for use with `@opentelemetry/instrumentation-kafkajs`: processing span wrapper with context mode (inherit/link/none), batch lineage for fan-in trace correlation, and correlation ID policy. Re-exports messaging constants and helpers from `common/constants`.
    Kafka plugin EDA enhancements : add `withProducerSpan` and `injectTraceHeaders` for PRODUCER semantics, processing-span context mode, batch lineage attributes, and correlation ID header support.
  - **autotel**: Version alignment with autotel-plugins.
  - **autotel-terminal**: Terminal trace viewer updates : README and setup docs, internal refactor (lib/), and CHANGELOG.

### Patch Changes

- Updated dependencies [23ed022]
  - autotel@2.18.0

## 9.0.0

### Minor Changes

- **Trace-first UI** : Group spans by trace; "Recent traces" list with root span name, duration, short trace ID, relative time; error badge when any span in the trace failed. Enter opens a trace to show its span tree (ASCII parent/child); Esc goes back. Toggle with `t` between trace view and flat span list.
- **Search and filter** : Press `/` to filter by span name; type to narrow. Combines with existing error-only filter (`e`).
- **Empty state and help** : Friendly empty message when no traces yet; `?` toggles help overlay with all shortcuts.
- **Relative time and error prominence** : "just now" / "2s ago" / "1m ago" next to traces/spans; "new error" indicator when a failed span appears.
- **Waterfall** : For the selected trace, details panel shows a simple duration waterfall (one row per span, horizontal bar by duration, indented by depth).
- **autotel attribute hints** : In span details, key attributes (`http.route`, `db.operation`, `code.function`, etc.) are shown first, then the rest.
- **Performance** : Throttled span updates to avoid UI jank when many spans arrive quickly.
- **Testing** : Pure logic in `src/lib/trace-model.ts` and `src/lib/format.ts` with unit tests; trace map, tree, filter, stats, relative time, waterfall sort.

### Patch Changes

- Updated dependencies [e62eb75]
  - autotel@2.17.0

## 8.0.0

### Patch Changes

- Updated dependencies [8a6769a]
  - autotel@2.16.0

## 7.0.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

### Patch Changes

- Updated dependencies [c68a580]
  - autotel@2.15.0

## 6.0.2

### Patch Changes

- Updated dependencies [78202aa]
  - autotel@2.14.2

## 6.0.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.
- Updated dependencies [acfd0de]
  - autotel@2.14.1

## 6.0.0

### Minor Changes

- 47c70fb: Update dependencies across all packages:
  - **OpenTelemetry**: Update to v2.5.0 (core packages) and v0.211.0 (SDK packages)
  - **AWS SDK**: Update all client packages from v3.972.0 to v3.975.0
  - **TypeScript ESLint**: Update from v8.53.1 to v8.54.0
  - **Turbo**: Update from v2.7.5 to v2.7.6
  - **Vitest**: Update from v4.0.17 to v4.0.18
  - **@types/node**: Update from v25.0.9 to v25.0.10
  - **Cloudflare Workers Types**: Update from v4.20260120.0 to v4.20260124.0

### Patch Changes

- Updated dependencies [47c70fb]
  - autotel@2.14.0

## 5.0.0

### Minor Changes

- 8256dac: Add comprehensive awaitly integration example demonstrating workflow instrumentation with autotel OpenTelemetry. The new `awaitly-example` app showcases successful workflows, error handling, decision tracking, cache behavior, and visualization features. Updated prettier to 3.8.1 across all packages.

### Patch Changes

- Updated dependencies [8256dac]
  - autotel@2.13.0

## 4.0.1

### Patch Changes

- 3e12422: Update dependencies across all packages:
  - OpenTelemetry packages: 0.208.0 → 0.210.0
  - OpenTelemetry SDK packages: 2.2.0 → 2.4.0
  - import-in-the-middle: 2.0.1 → 2.0.4
  - pino: 10.1.0 → 10.1.1
  - TypeScript ESLint: 8.52.0 → 8.53.0
  - vitest: 4.0.16 → 4.0.17
  - @types/node: 25.0.3 → 25.0.8
- Updated dependencies [3e12422]
  - autotel@2.12.1

## 4.0.0

### Minor Changes

- 8831cf8: Add canonical log lines (wide events) feature to automatically emit spans as comprehensive log records. Implements the "canonical log line" pattern: one log line per request with all context, making logs queryable as structured data instead of requiring string search.

  **autotel:**
  - New `canonicalLogLines` option in `init()` config
  - `CanonicalLogLineProcessor` for automatic span-to-log conversion
  - Supports root spans only, custom message format, min level filtering
  - Works with any logger (Pino, Winston) or OTel Logs API
  - Attribute redaction support for sensitive data

### Patch Changes

- Updated dependencies [8831cf8]
  - autotel@2.12.0

## 3.0.0

### Patch Changes

- Updated dependencies [92206af]
  - autotel@2.11.0

## 2.1.0

### Minor Changes

- 723c889: ### autotel-terminal
  - Improve keyboard input handling with stdin detection for better compatibility in non-TTY environments
  - Add unique React keys to prevent rendering conflicts when spans have duplicate IDs
  - Gracefully handle environments where raw mode is not supported

  ### autotel-cloudflare
  - Update `@cloudflare/workers-types` dependency to latest version

  ### autotel-subscribers
  - Update `@cloudflare/workers-types` dependency to latest version

## 2.0.0

### Minor Changes

- e5337b0: Add new span processors, exporters, terminal dashboard, and type-safe attributes module

  **autotel:**
  - Add `PrettyConsoleExporter` for colorized, hierarchical trace output in the terminal
  - Add `FilteringSpanProcessor` for filtering spans by custom criteria
  - Add `SpanNameNormalizer` for normalizing span names (removing IDs, hashes, etc.)
  - Add `AttributeRedactingProcessor` for redacting sensitive span attributes
  - Export new processors via `autotel/processors` and `autotel/exporters`
  - Add new `autotel/attributes` module with type-safe attribute helpers:
    - Key builders: `attrs.user.id()`, `attrs.http.method()`, etc.
    - Object builders: `attrs.user.data()`, `attrs.db.client.data()`, etc.
    - Attachers: `setUser()`, `httpServer()`, `identify()`, `setError()`, etc.
    - PII guardrails: `safeSetAttributes()` with redaction, hashing, and validation
    - Domain helpers: `transaction()` for business transactions
    - Resource merging: `mergeServiceResource()` for enriching resources
  - Fix ESLint config to disable `unicorn/number-literal-case` (conflicts with Prettier)

  **autotel-terminal (new package):**
  - React-ink powered terminal dashboard for viewing traces in real-time
  - Live span streaming with pause/resume functionality
  - Error filtering and statistics display
  - Auto-wires to existing tracer provider

  **autotel-subscribers:**
  - Fix `AmplitudeSubscriber` to correctly use Amplitude SDK pattern where `init()`, `track()`, and `flush()` are separate module exports

  **Examples:**
  - Add Next.js example app
  - Add TanStack Start example app

### Patch Changes

- Updated dependencies [e5337b0]
  - autotel@2.10.0

## 2.0.0

### Patch Changes

- Updated dependencies [86ae1a8]
  - autotel@2.10.0
