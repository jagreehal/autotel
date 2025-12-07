---
'autotel': minor
---

Add messaging adapters, webhook tracing, and distributed workflow support:

- **`autotel/messaging/adapters`** - Pre-built adapter configurations for common messaging systems (NATS JetStream, Temporal, Cloudflare Queues) with system-specific attribute extraction and context propagation support. Includes Datadog trace context extractor for cross-platform compatibility.

- **`autotel/webhook`** - "Parking Lot" pattern for tracing async callbacks and webhooks that return hours or days later. Park trace context when initiating operations and retrieve it when callbacks arrive, maintaining end-to-end trace correlation across long-lived async operations.

- **`autotel/workflow-distributed`** - Distributed workflow tracing with cross-service correlation using W3C baggage propagation. Track workflows that span multiple microservices by propagating workflow identity (workflowId, stepName, stepIndex) via message headers.

- **`autotel/messaging-testing`** - Testing utilities and helpers for messaging system integration tests.
