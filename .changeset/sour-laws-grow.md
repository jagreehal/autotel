---
'autotel-subscribers': minor
'autotel-cloudflare': minor
'autotel-backends': minor
'autotel-tanstack': minor
'autotel-plugins': minor
'autotel-edge': minor
'autotel-aws': minor
'autotel-mcp': minor
'autotel': minor
---

### autotel

Add event-driven observability and workflow tracing features:

- **`autotel/messaging`** - First-class support for message-based systems with `traceProducer` and `traceConsumer` helpers. Auto-sets SpanKind, semantic attributes (`messaging.system`, `messaging.destination.name`), and trace header propagation.

- **`autotel/business-baggage`** - Type-safe baggage schemas with built-in guardrails for cross-service context propagation. Includes PII redaction, high-cardinality hashing, size limits, and enum validation.

- **`autotel/workflow`** - Workflow and saga tracing with `traceWorkflow` and `traceStep`. Supports compensation handlers that run in reverse order on failure, step linking, and WeakMap-based state isolation.

### autotel-tanstack

- Fix Vite build configuration to externalize `autotel` for client bundles (SSR compatibility)

### autotel-aws

- Add CDK infrastructure example with LocalStack support for the AWS Lambda example app
