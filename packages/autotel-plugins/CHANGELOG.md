# autotel-plugins

## 0.8.0

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
  - autotel@2.10.0

## 0.7.1

### Patch Changes

- Updated dependencies [05f2d95]
  - autotel@2.9.0

## 0.7.0

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
  - autotel@2.8.0

## 0.6.6

### Patch Changes

- Updated dependencies [bc0e668]
  - autotel@2.7.0

## 0.6.5

### Patch Changes

- Updated dependencies [2ae2ece]
  - autotel@2.6.0

## 0.6.4

### Patch Changes

- Updated dependencies [745ab4c]
  - autotel@2.5.0

## 0.6.3

### Patch Changes

- Updated dependencies [31edf41]
  - autotel@2.4.0

## 0.6.2

### Patch Changes

- Updated dependencies [38f0462]
  - autotel@2.4.0

## 0.6.1

### Patch Changes

- Updated dependencies [bb7c547]
  - autotel@2.3.0

## 0.6.0

### Minor Changes

- 79f49aa: Updated example

### Patch Changes

- Updated dependencies [79f49aa]
  - autotel@2.2.0

## 0.5.0

### Minor Changes

- ec3b0c7: Add YAML configuration support and zero-config auto-instrumentation
  - **YAML Configuration**: Configure autotel via `autotel.yaml` files with environment variable substitution
  - **Zero-config setup**: New `autotel/auto` entry point for automatic initialization from YAML or environment variables
  - **ESM loader registration**: New `autotel/register` entry point for easier ESM instrumentation setup without NODE_OPTIONS
  - **Improved CommonJS compatibility**: Better support for CommonJS plugins and instrumentations

## Released

Initial release as `autotel-plugins` (renamed from `autotel-plugins`).
