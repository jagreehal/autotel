# autotel

## 2.9.0

### Minor Changes

- 05f2d95: Add messaging adapters, webhook tracing, and distributed workflow support:
  - **`autotel/messaging/adapters`** - Pre-built adapter configurations for common messaging systems (NATS JetStream, Temporal, Cloudflare Queues) with system-specific attribute extraction and context propagation support. Includes Datadog trace context extractor for cross-platform compatibility.
  - **`autotel/webhook`** - "Parking Lot" pattern for tracing async callbacks and webhooks that return hours or days later. Park trace context when initiating operations and retrieve it when callbacks arrive, maintaining end-to-end trace correlation across long-lived async operations.
  - **`autotel/workflow-distributed`** - Distributed workflow tracing with cross-service correlation using W3C baggage propagation. Track workflows that span multiple microservices by propagating workflow identity (workflowId, stepName, stepIndex) via message headers.
  - **`autotel/messaging-testing`** - Testing utilities and helpers for messaging system integration tests.

## 2.8.0

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

## 2.7.0

### Minor Changes

- bc0e668: feat: Add AWS and TanStack Start instrumentation packages

  ## New Packages

  ### autotel-aws

  OpenTelemetry instrumentation for AWS services - ergonomic, vendor-agnostic observability.

  **Features:**
  - **Lambda Handler Instrumentation** - `wrapHandler()` with automatic cold start detection
  - **Zero-Config Mode** - `import 'autotel-aws/lambda/auto'` reads from env vars
  - **AWS SDK v3 Auto-Instrumentation** - `autoInstrumentAWS()` patches all SDK clients globally
  - **Per-Client Instrumentation** - `instrumentSDK()` for selective tracing
  - **SQS Producer/Consumer** - End-to-end distributed tracing with automatic context propagation
  - **SNS Publisher** - Automatic context injection for pub/sub tracing
  - **Kinesis Producer/Consumer** - Stream processing with trace context in records
  - **Step Functions Executor/Worker** - State machine orchestration with distributed tracing
  - **EventBridge Publisher** - Event-driven architecture tracing
  - **X-Ray Compatibility** - `setXRayAnnotation()` and `setXRayMetadata()` for X-Ray users
  - **Middy Middleware** - `tracingMiddleware()` for Middy-based handlers
  - **Lambda Layer** - Pre-built layer for easy deployment
  - **Service-Specific Semantic Helpers** - `traceS3()`, `traceDynamoDB()`, `traceKinesis()`, etc.

  **Tree-shakeable entry points:** `/lambda`, `/lambda/auto`, `/sdk`, `/s3`, `/dynamodb`, `/sqs`, `/sns`, `/kinesis`, `/step-functions`, `/eventbridge`, `/xray`, `/testing`, `/attributes`

  ### autotel-tanstack

  OpenTelemetry instrumentation for TanStack Start - automatic tracing for server functions, middleware, and route loaders.

  **Features:**
  - **Zero-Config Option** - `import 'autotel-tanstack/auto'` to enable tracing via env vars
  - **Middleware-Based API** - `tracingMiddleware()` and `functionTracingMiddleware()` align with TanStack patterns
  - **Server Function Tracing** - Automatic spans for `createServerFn()` with argument/result capture
  - **Route Loader Tracing** - `traceLoader()` and `traceBeforeLoad()` for route instrumentation
  - **Handler Wrapper** - `wrapStartHandler()` for complete request tracing with full control
  - **Browser Support** - Separate browser builds with no-op implementations
  - **Testing Utilities** - `createTestHarness()` for test assertions

  **Supported frameworks:** @tanstack/react-start and @tanstack/solid-start

  **Tree-shakeable entry points:** `/auto`, `/middleware`, `/server-functions`, `/loaders`, `/context`, `/handlers`, `/testing`, `/debug-headers`, `/metrics`, `/error-reporting`

  ## Fixes
  - **autotel-backends**: Align config property name (`otlpHeaders` → `headers`) with core autotel API
  - **autotel-edge**: Remove unnecessary type cast in dummy context
  - **autotel-mcp**: Fix internal import paths

## 2.6.0

### Minor Changes

- 2ae2ece: Add ESM misconfiguration detection and improve documentation
  - Add `isESMMode()` detection to provide context-aware error messages when `@opentelemetry/auto-instrumentations-node` fails to load
  - ESM users now get detailed setup instructions including the correct `autotel/register` pattern
  - Add informational warning when using `integrations` in ESM mode, guiding users to the recommended `getNodeAutoInstrumentations()` pattern
  - Update README.md with modern ESM setup instructions using `autotel/register` (Node 18.19+)
  - Document requirement to install `@opentelemetry/auto-instrumentations-node` as a direct dependency for ESM apps

## 2.5.0

### Minor Changes

- 745ab4c: Add zero-config built-in logger option. Users can now use autotel without providing a logger - a built-in structured JSON logger with automatic trace context injection is used by default. The built-in logger supports dynamic log level control per-request and can be used directly via `createBuiltinLogger()` from 'autotel/logger'. Internal autotel logs are now silent by default to avoid spam.

## 2.4.0

### Minor Changes

- 31edf41: Lazy-load logger + auto instrumentation packages so we only require
  optional peers when a matching logger/integration is configured. Expose
  test hooks for the loader so we can simulate different setups without
  installing every instrumentation locally.

## 2.4.0

### Minor Changes

- 38f0462: Fixed TypeScript type inference for `trace()` function when using the two-argument form (`trace(name, fn)`) or options form (`trace(options, fn)`). Factory functions with no arguments now correctly infer their return types instead of defaulting to `unknown`.

## 2.3.0

### Minor Changes

- bb7c547: Add support for array attributes in trace context

  Extended `setAttribute` and `setAttributes` methods to support array values (string[], number[], boolean[]) in addition to primitive values, aligning with OpenTelemetry's attribute specification. This allows setting attributes like tags, scores, or flags as arrays.

## 2.2.0

### Minor Changes

- 79f49aa: Updated example

## Released

Initial release as `autotel` (renamed from `autotel`).
