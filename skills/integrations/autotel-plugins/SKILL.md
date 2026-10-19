---
name: autotel-plugins
description: >
  Use this skill when instrumenting BigQuery, Kafka, or RabbitMQ with OpenTelemetry — plugins for libraries with no official OTel support (BigQuery) or where the official package lacks processing spans, batch lineage, and correlation IDs (Kafka, RabbitMQ).
---

# autotel-plugins

Instrumentation plugins for libraries that have no official OTel support or where official support is incomplete. Three plugins ship in this package:

| Plugin   | Subpath                    | Use case                                                                                                                                      |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| BigQuery | `autotel-plugins/bigquery` | No official OTel instrumentation exists                                                                                                       |
| Kafka    | `autotel-plugins/kafka`    | Official `@opentelemetry/instrumentation-kafkajs` only traces produce/consume; this adds processing spans, batch lineage, and correlation IDs |
| RabbitMQ | `autotel-plugins/rabbitmq` | Composition layer on top of `@opentelemetry/instrumentation-amqplib`: adds consume/publish spans, ack tracking, batch lineage                 |

All three are also re-exported from the root `autotel-plugins` entry point. RabbitMQ helpers whose names clash with Kafka's are renamed there (`injectRabbitMQTraceHeaders`, `extractRabbitMQBatchLineage`, `normalizeRabbitMQHeaders`, ...); on the `/rabbitmq` subpath they keep the plain names.

## Setup

Install the package plus the relevant peer dependency for your plugin:

```bash
# BigQuery
pnpm add autotel-plugins @google-cloud/bigquery

# Kafka (official instrumentation is optional but recommended)
pnpm add autotel-plugins @opentelemetry/instrumentation-kafkajs

# RabbitMQ (official instrumentation is optional but recommended)
pnpm add autotel-plugins @opentelemetry/instrumentation-amqplib
```

## Configuration / Core Patterns

### BigQuery: `instrumentBigQuery`

Patches the BigQuery client to create spans for `query()`, `createQueryJob()`, `createQueryStream()`, `createJob()`, job results, and table `insert`/`getRows`/load/copy/extract jobs. Dataset and table create/delete are traced only with `instrumentAdminOps: true`. No official OTel plugin exists for BigQuery so this is the only tracing path.

```ts
import { BigQuery } from '@google-cloud/bigquery';
import { instrumentBigQuery } from 'autotel-plugins/bigquery';
// or: import { instrumentBigQuery } from 'autotel-plugins';

const bq = new BigQuery({ projectId: 'my-project' });
instrumentBigQuery(bq, {
  captureQueryText: 'sanitized', // 'never' | 'summary' (default) | 'sanitized' | 'raw'
  includeQueryHash: true, // default: true
  instrumentAdminOps: false, // dataset/table create/delete (default: false)
});

// All subsequent calls create spans automatically
const [rows] = await bq.query('SELECT 1');
```

`BigQueryInstrumentation` class is also exported for programmatic use, but `instrumentBigQuery(instance, config)` is the primary API.

### Kafka: processing spans

Use `withProcessingSpan` to wrap each message handler. This is the core primitive. It creates a CONSUMER-kind span with proper messaging attributes and context propagation.

```ts
import { withProcessingSpan } from 'autotel-plugins/kafka';

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    await withProcessingSpan(
      {
        name: 'order.process',
        headers: message.headers, // W3C traceparent extracted from here
        contextMode: 'inherit', // 'inherit' | 'link' | 'none'
        topic,
        consumerGroup: 'payments',
        partition,
        offset: message.offset,
      },
      async (span) => {
        await processOrder(message);
      },
    );
  },
});
```

**`contextMode` values:**

| Mode      | Behaviour                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inherit` | Default. No active span: parent = extracted producer context. Active span exists: parent = active span, link to the extracted context if it is a different trace. |
| `link`    | Parent = current context (active span or root); always links to the extracted context. Good for async fan-out.                                                    |
| `none`    | Parent = current context; no links to the extracted context. Use when trace propagation is disabled via feature flag.                                             |

Feature flag pattern:

```ts
contextMode: process.env.KAFKA_PROPAGATE_TRACE !== 'false' ? 'inherit' : 'none',
```

### Kafka: producer spans

```ts
import { withProducerSpan, injectTraceHeaders } from 'autotel-plugins/kafka';

await withProducerSpan(
  { name: 'order.publish', topic: 'orders', messageKey: orderId },
  async (span) => {
    // Inject headers inside the PRODUCER span so consumers can extract the context
    const headers = injectTraceHeaders({}); // adds the correlation ID header by default
    await producer.send({
      topic: 'orders',
      messages: [{ key: orderId, value: JSON.stringify(order), headers }],
    });
  },
);
```

### Kafka: batch processing

For `eachBatch` handlers, `withBatchConsumer` creates a batch-level span and optionally per-message child spans:

```ts
import { withBatchConsumer } from 'autotel-plugins/kafka';

await consumer.run({
  eachBatch: withBatchConsumer(
    {
      name: 'orders.batch',
      consumerGroup: 'processor',
      perMessageSpans: 'all', // 'all' | 'errors' | 'none' (default: 'none')
    },
    async ({ batch, resolveOffset }) => {
      for (const message of batch.messages) {
        await processOrder(message);
        resolveOffset(message.offset);
      }
    },
  ),
});
```

### Kafka: batch lineage (fan-in)

When a single downstream span is the result of many upstream messages (e.g., settlement batching), use `extractBatchLineage` to create span links for each upstream trace:

```ts
import {
  extractBatchLineage,
  withProcessingSpan,
  SEMATTRS_LINKED_TRACE_ID_COUNT,
  SEMATTRS_LINKED_TRACE_ID_HASH,
} from 'autotel-plugins/kafka';

const lineage = extractBatchLineage(batch, { maxLinks: 50 });

await withProcessingSpan(
  {
    name: 'settlement.batch',
    headers: {},
    contextMode: 'none',
    links: lineage.links,
    topic: 'settlements',
    consumerGroup: 'batcher',
  },
  async (span) => {
    span.setAttribute(
      SEMATTRS_LINKED_TRACE_ID_COUNT,
      lineage.linked_trace_id_count,
    );
    span.setAttribute(
      SEMATTRS_LINKED_TRACE_ID_HASH,
      lineage.linked_trace_id_hash,
    );
    await processSettlement(batch);
  },
);
```

### Kafka: Map-based headers (e.g., @platformatic/kafka)

```ts
import { normalizeHeaders, withProcessingSpan } from 'autotel-plugins/kafka';

// normalizeHeaders accepts Map<string, Buffer | string> or Record<string, ...>
const headers = normalizeHeaders(message.headers);

await withProcessingSpan(
  { name: 'order.process', headers, contextMode: 'inherit', topic },
  async () => {
    await processOrder(message);
  },
);
```

### RabbitMQ: consume and publish spans

RabbitMQ mirrors the Kafka API surface but for AMQP:

```ts
import { withConsumeSpan } from 'autotel-plugins/rabbitmq';

channel.consume('orders', async (msg) => {
  if (!msg) return;
  await withConsumeSpan(
    {
      name: 'order.process',
      headers: msg.properties.headers,
      contextMode: 'inherit',
      queue: 'orders',
      exchange: msg.fields.exchange,
      routingKey: msg.fields.routingKey,
    },
    async (span) => {
      await processOrder(msg);
      channel.ack(msg);
    },
  );
});
```

Pass `deferSpanEnd: true` with `ackTimeoutMs` to get `(span, { ack, nack, reject })` controls and end the span when the message is settled.

Publisher:

```ts
import { withPublishSpan, injectTraceHeaders } from 'autotel-plugins/rabbitmq';
// root equivalent: import { withPublishSpan, injectRabbitMQTraceHeaders } from 'autotel-plugins';

await withPublishSpan(
  {
    name: 'order.publish',
    exchange: 'orders',
    routingKey: 'order.created',
    correlationId: orderId,
  },
  async (span) => {
    const headers = injectTraceHeaders({}, { correlationId: orderId });
    channel.publish('orders', 'order.created', content, { headers });
  },
);
```

### Semantic attribute constants

All plugins export semantic attribute name constants. Use these instead of string literals:

```ts
import { SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP } from 'autotel-plugins/kafka';
// BigQuery and DB constants are only on the root entry:
import { SEMATTRS_GCP_BIGQUERY_JOB_ID } from 'autotel-plugins';
```

## Common Mistakes

### HIGH: Injecting trace headers outside the producer span

Headers must be injected while the producer span is active. Calling `injectTraceHeaders` before `withProducerSpan` captures whatever span is active at call time. Not the producer span.

Wrong:

```ts
const headers = injectTraceHeaders({}); // captures wrong span context
await withProducerSpan({ ... }, async () => {
  await producer.send({ ..., messages: [{ headers }] });
});
```

Correct:

```ts
await withProducerSpan({ name: 'order.publish', topic: 'orders' }, async () => {
  const headers = injectTraceHeaders({}); // captures producer span context
  await producer.send({ ..., messages: [{ headers }] });
});
```

### HIGH: Using `contextMode: 'inherit'` on batch fan-in spans

Batch fan-in (many messages → one output) should use `'none'` (or `'link'`) plus `extractBatchLineage` links. Using `'inherit'` with one message's headers parents the span to that single trace and drops every other upstream trace.

Wrong:

```ts
await withProcessingSpan({ name: 'settlement.batch', contextMode: 'inherit', ... }, async () => { ... });
```

Correct:

```ts
const lineage = extractBatchLineage(batch);
await withProcessingSpan({ name: 'settlement.batch', contextMode: 'none', links: lineage.links, ... }, async () => { ... });
```

### MEDIUM: Calling `instrumentBigQuery` after queries have already been made

`instrumentBigQuery` wraps the instance methods at call time. Any method calls made before instrumentation are not traced.

Correct: call `instrumentBigQuery` immediately after constructing the `BigQuery` instance, before making any queries.

### MEDIUM: Importing from root when only one plugin is needed

The root `autotel-plugins` entry re-exports all three plugins. If your bundle tree-shakes poorly or you want to be explicit, import from the subpath:

```ts
// Preferred when only using Kafka
import { withProcessingSpan } from 'autotel-plugins/kafka';

// Root import is fine but includes all plugin code
import { withProcessingSpan } from 'autotel-plugins';
```

## Version

Targets autotel-plugins v0.21.13. Optional peer dependencies: `@google-cloud/bigquery >=9.2.0`, `@opentelemetry/instrumentation-kafkajs >=0.32.0`, `@opentelemetry/instrumentation-amqplib >=0.70.0`.
