# autotel-cloudflare

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
