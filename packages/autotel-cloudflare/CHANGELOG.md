# autotel-cloudflare

## 2.18.6

### Patch Changes

- b764a97: Added web api headers get

## 2.18.5

### Patch Changes

- dc471ef: Enhanced request logger with fork support for async background work, execution logger for edge runtimes, structured errors with internal context, init locking for framework plugins, silent/minLevel logging, and attribute redaction for PII compliance.
- Updated dependencies [dc471ef]
  - autotel-edge@3.16.4

## 2.18.4

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
  - autotel-edge@3.16.3

## 2.18.3

### Patch Changes

- 91f6468: Modified module wrapper

## 2.18.2

### Patch Changes

- Updated dependencies [e6ef4e6]
  - autotel-edge@3.16.2

## 2.18.1

### Patch Changes

- Updated dependencies [99a8d84]
  - autotel-edge@3.16.1

## 2.18.0

### Minor Changes

- 04c370a: This release rolls out a monorepo-wide refresh across the Autotel package family with coordinated minor updates.

  Highlights:
  - Align package internals and workspace metadata for the next release wave.
  - Improve reliability of test and quality workflows used across packages.
  - Keep package behavior and public APIs consistent while shipping incremental enhancements across the ecosystem.

### Patch Changes

- Updated dependencies [04c370a]
  - autotel-edge@3.16.0

## 2.17.1

### Patch Changes

- 65b2fc9: - Bug fixes and dependency updates across packages.
  - example-vitest: API tests use a random port (when `API_BASE_URL`/`PORT` unset) to avoid EADDRINUSE on port 3000.
- Updated dependencies [65b2fc9]
  - autotel-edge@3.15.1

## 2.17.0

### Minor Changes

- eb28f60: **autotel**
  - **Request logger**: `getRequestLogger(ctx?, options?)` with `set()`, `info()`, `warn()`, `error()`, `getContext()`, and `emitNow(overrides?)`. Optional `onEmit` callback for manual fan-out. Writes to span attributes/events so canonical log lines still emit one wide event per request.
  - **Structured errors**: `createStructuredError()`, `getStructuredErrorAttributes()`, `recordStructuredError()`. Supports `message`, `why`, `fix`, `link`, `code`, `status`, `cause`, `details`.
  - **parseError**: `parseError(error)` returns `{ message, status, why?, fix?, link?, code?, details?, raw }` for frontend/API consumers. Export from main entry and `autotel/parse-error`.
  - **Drain pipeline**: `createDrainPipeline()` for batching, retry with backoff, flush, and shutdown. Use with `canonicalLogLines.drain`. Export from main entry and `autotel/drain-pipeline`.
  - **Canonical log lines**: `shouldEmit`, `drain`, `onDrainError`, `keep` (declarative tail sampling), and `pretty` (tree-formatted dev output) options. Adds `duration` (formatted) field alongside `duration_ms`. Respects `autotel.log.level` span attribute for explicit level. New types `CanonicalLogLineEvent`, `KeepCondition`.
  - **formatDuration**: `formatDuration(ms)` formats milliseconds as human-readable strings (`45ms`, `1.2s`, `1m 5s`).

### Patch Changes

- Updated dependencies [eb28f60]
  - autotel-edge@3.15.0

## 2.16.0

### Minor Changes

- 37190fd: **autotel-cloudflare**
  - Bindings instrumentation: add caching and fix `this` binding for wrapped proxies
  - Improve bindings coverage for AI, Vectorize, Hyperdrive, Queue Producer, Analytics Engine, Images, Rate Limiter, and Browser Rendering
  - Enhance instrument wrapper and fetch instrumentation
  - Add bindings cache and this-binding tests

  **autotel-edge**
  - Add `DataSafetyConfig` for sensitive attribute control: `redactQueryParams`, `captureDbStatement` (D1 SQL: full/obfuscated/off), `emailHeaderAllowlist`

### Patch Changes

- Updated dependencies [37190fd]
  - autotel-edge@3.14.0

## 2.15.0

### Minor Changes

- 1155c72: - **autotel-backends**: Add Grafana backend; export and type updates.
  - **autotel, autotel-\***: Dependency bumps, docs/comment updates, and version alignment across the monorepo.

### Patch Changes

- Updated dependencies [1155c72]
  - autotel-edge@3.13.0

## 2.14.0

### Minor Changes

- 32e3cd9: Add first-class Cloudflare Workflows instrumentation.
  - `autotel-edge` now exports `WorkflowTrigger` and includes it in the `Trigger` union.
  - `autotel-cloudflare` `instrumentWorkflow()` now passes a workflow trigger into config resolution and emits spans for `run`, `step.do`, and `step.sleep` with `workflow.instance_id` and cold start attributes.

### Patch Changes

- Updated dependencies [32e3cd9]
  - autotel-edge@3.12.0

## 2.13.0

### Minor Changes

- c558982: Add full Cloudflare native observability parity.
  - **New binding instrumentations**: AI, Vectorize, Hyperdrive, Queue Producer, Analytics Engine, Images, Rate Limiter, and Browser Rendering
  - **`setAttr()` helper**: Guards against undefined/null attribute values when setting span attributes
  - **Auto-detection rewrite**: Uses `hasExactMethods()` and `isWrapped()` guards with most-specific-first ordering (fixes R2/KV detection bug)
  - **`extractCfAttributes()`**: Extracts 14 `cloudflare.*` request attributes (colo, ray_id, geo, ASN, TLS, etc.)
  - **Exports**: Explicit named exports for tree-shaking
  - **Tests**: 88 new tests (173 total)

## 2.12.0

### Minor Changes

- c710c71: Add option to hide free/busy times (or selected attributes) in console export and related exporters.

### Patch Changes

- Updated dependencies [c710c71]
  - autotel-edge@3.11.0

## 2.11.0

### Minor Changes

- d1bd8cd: - **autotel-sentry**: README updates : clarify Sentry SDK + OTel scenario, link to Sentry OTLP docs, note that Sentry ingestion request spans are not sent, fix `SentrySpanProcessor` backtick typo, add spec-volatility note.
  - **autotel-backends**: Preserve caught error in Google Cloud config : attach original error as `cause` when throwing the user-facing error so the `preserve-caught-error` lint rule is satisfied.

### Patch Changes

- Updated dependencies [d1bd8cd]
  - autotel-edge@3.10.0

## 2.10.1

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
  - autotel-edge@3.9.1

## 2.10.0

### Minor Changes

- c68a580: - **autotel**: Add correlation ID support for event-driven observability (stable join key across events, logs, and spans via AsyncLocalStorage; optional baggage propagation). Add events configuration for `init()`: `includeTraceContext`, `traceUrl`, and baggage enrichment with allow/deny and transforms. Event queue and event subscriber now attach correlation ID and trace context to events. New `autotel/correlation-id` and `autotel/events-config` types used internally; init accepts `events` option.
  - **autotel-subscribers**: EventSubscriber base class and adapters (PostHog, Mixpanel, Amplitude) updated to use `autotel/event-subscriber` types and AutotelEventContext; graceful shutdown and payload normalization aligned with new event context and correlation ID.
  - **autotel-edge**, **autotel-cloudflare**, **autotel-aws**, **autotel-backends**, **autotel-tanstack**, **autotel-terminal**, **autotel-plugins**, **autotel-cli**, **autotel-mcp**, **autotel-web**: Version bumps for compatibility with autotel core.

### Patch Changes

- Updated dependencies [c68a580]
  - autotel-edge@3.9.0

## 2.9.1

### Patch Changes

- acfd0de: Add comprehensive test coverage for Datadog backend configuration, including validation, direct cloud ingestion, agent mode, and OTLP logs export functionality.
- Updated dependencies [acfd0de]
  - autotel-edge@3.8.1

## 2.9.0

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
  - autotel-edge@3.8.0

## 2.8.2

### Patch Changes

- Updated dependencies [8256dac]
  - autotel-edge@3.7.0

## 2.8.1

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
  - autotel-edge@3.6.1

## 2.8.0

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
  - autotel-edge@3.6.0

## 2.7.0

### Minor Changes

- 723c889: ### autotel-terminal
  - Improve keyboard input handling with stdin detection for better compatibility in non-TTY environments
  - Add unique React keys to prevent rendering conflicts when spans have duplicate IDs
  - Gracefully handle environments where raw mode is not supported

  ### autotel-cloudflare
  - Update `@cloudflare/workers-types` dependency to latest version

  ### autotel-subscribers
  - Update `@cloudflare/workers-types` dependency to latest version

## 2.6.0

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
  - autotel-edge@3.5.0

## 2.6.0

### Minor Changes

- 86ae1a8: Add new span processors, exporters, and terminal dashboard

  **autotel:**
  - Add `PrettyConsoleExporter` for colorized, hierarchical trace output in the terminal
  - Add `FilteringSpanProcessor` for filtering spans by custom criteria
  - Add `SpanNameNormalizer` for normalizing span names (removing IDs, hashes, etc.)
  - Add `AttributeRedactingProcessor` for redacting sensitive span attributes
  - Export new processors via `autotel/processors` and `autotel/exporters`

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

- Updated dependencies [86ae1a8]
  - autotel-edge@3.4.0

## 2.5.0

### Minor Changes

- e904227: ### autotel

  Add event-driven observability and workflow tracing features:
  - **`autotel/messaging`** - First-class support for message-based systems with `traceProducer` and `traceConsumer` helpers. Auto-sets SpanKind, semantic attributes (`messaging.system`, `messaging.destination.name`), and trace header propagation.
  - **`autotel/business-baggage`** - Type-safe baggage schemas with built-in guardrails for cross-service context propagation. Includes PII redaction, high-cardinality hashing, size limits, and enum validation.
  - **`autotel/workflow`** - Workflow and saga tracing with `traceWorkflow` and `traceStep`. Supports compensation handlers that run in reverse order on failure, step linking, and WeakMap-based state isolation.

  ### autotel-tanstack
  - Fix Vite build configuration to externalize `autotel` for client bundles (SSR compatibility)

  ### autotel-aws
  - Add CDK infrastructure example with LocalStack support for the AWS Lambda example app

### Patch Changes

- Updated dependencies [e904227]
  - autotel-edge@3.3.0

## 2.4.1

### Patch Changes

- Updated dependencies [bc0e668]
  - autotel-edge@3.2.1

## 2.4.0

### Minor Changes

- bb7c547: Add support for array attributes in trace context

  Extended `setAttribute` and `setAttributes` methods to support array values (string[], number[], boolean[]) in addition to primitive values, aligning with OpenTelemetry's attribute specification. This allows setting attributes like tags, scores, or flags as arrays.

### Patch Changes

- Updated dependencies [bb7c547]
  - autotel-edge@3.2.0

## 2.3.0

### Minor Changes

- 79f49aa: Updated example

### Patch Changes

- Updated dependencies [79f49aa]
  - autotel-edge@3.1.0

## 2.2.0

### Minor Changes

- ec3b0c7: Add YAML configuration support and zero-config auto-instrumentation
  - **YAML Configuration**: Configure autotel via `autotel.yaml` files with environment variable substitution
  - **Zero-config setup**: New `autotel/auto` entry point for automatic initialization from YAML or environment variables
  - **ESM loader registration**: New `autotel/register` entry point for easier ESM instrumentation setup without NODE_OPTIONS
  - **Improved CommonJS compatibility**: Better support for CommonJS plugins and instrumentations

## Released

Initial release as `autotel-cloudflare` (renamed from `autotel-cloudflare`).
