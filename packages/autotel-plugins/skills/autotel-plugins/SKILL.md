---
name: autotel-plugins
description: >
  OpenTelemetry instrumentation plugins for BigQuery, Kafka, and RabbitMQ — covering libraries with no official OTel support (BigQuery) or where the official package lacks critical DX (Kafka/RabbitMQ processing spans, batch lineage, correlation IDs).
type: integration
library: autotel-plugins
library_version: '0.19.4'
sources:
  - jagreehal/autotel:packages/autotel-plugins/src/index.ts
  - jagreehal/autotel:packages/autotel-plugins/src/kafka/index.ts
  - jagreehal/autotel:packages/autotel-plugins/src/rabbitmq/index.ts
  - jagreehal/autotel:packages/autotel-plugins/src/bigquery/index.ts
---

# autotel-plugins

Instrumentation plugins for libraries that have no official OTel support or where official support is incomplete. Three plugins ship in this package:

| Plugin   | Subpath                    | Use case                                                                                                                                      |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| BigQuery | `autotel-plugins/bigquery` | No official OTel instrumentation exists                                                                                                       |
| Kafka    | `autotel-plugins/kafka`    | Official `@opentelemetry/instrumentation-kafkajs` only traces produce/consume; this adds processing spans, batch lineage, and correlation IDs |
| RabbitMQ | `autotel-plugins/rabbitmq` | Composition layer on top of `@opentelemetry/instrumentation-amqplib` — adds consume/publish spans, ack tracking, batch lineage                |

All three are also re-exported from the root `autotel-plugins` entry point.

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

### BigQuery — `instrumentBigQuery`

Wraps a `BigQuery` instance to create spans for `query()`, `createQueryJob()`, dataset operations, and table operations. No official OTel plugin exists for BigQuery so this is the only tracing path.

```ts
import { BigQuery } from '@google-cloud/bigquery';
import { instrumentBigQuery } from 'autotel-plugins/bigquery';
// or: import { instrumentBigQuery } from 'autotel-plugins';

const bq = new BigQuery({ projectId: 'my-project' });
instrumentBigQuery(bq, {
  captureQueryText: true, // record SQL in span attributes (default: false)
  captureJobLocation: true, // record job location attribute (default: true)
});

// All subsequent calls create spans automatically
const [rows] = await bq.query('SELECT 1');
```

`BigQueryInstrumentation` class is also exported for programmatic use, but `instrumentBigQuery(instance, config)` is the primary API.

### Kafka — processing spans

Use `withProcessingSpan` to wrap each message handler. This is the core primitive — it creates a CONSUMER-kind span with proper messaging attributes and context propagation.

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

| Mode      | Behaviour                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| `inherit` | Continues the producer trace (parent = extracted context). If a different active span exists, links to it instead. |
| `link`    | Always starts a fresh span; links to the extracted trace. Good for async fan-out.                                  |
| `none`    | Starts a fresh span with no links. Use when trace propagation is disabled via feature flag.                        |

Feature flag pattern:

```ts
contextMode: process.env.KAFKA_PROPAGATE_TRACE !== 'false' ? 'inherit' : 'none',
```

### Kafka — producer spans

```ts
import { withProducerSpan, injectTraceHeaders } from 'autotel-plugins/kafka';

await withProducerSpan(
  { name: 'order.publish', topic: 'orders', messageKey: orderId },
  async (span) => {
    // Inject headers inside the PRODUCER span so consumers can extract the context
    const headers = injectTraceHeaders(
      {},
      { includeCorrelationIdHeader: true },
    );
    await producer.send({
      topic: 'orders',
      messages: [{ key: orderId, value: JSON.stringify(order), headers }],
    });
  },
);
```

### Kafka — batch processing

For `eachBatch` handlers, `withBatchConsumer` creates a batch-level span and optionally per-message child spans:

```ts
import { withBatchConsumer } from 'autotel-plugins/kafka';

await consumer.run({
  eachBatch: withBatchConsumer(
    {
      name: 'orders.batch',
      consumerGroup: 'processor',
      perMessageSpans: 'all', // 'all' | 'errors-only' | 'none'
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

### Kafka — batch lineage (fan-in)

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

### Kafka — Map-based headers (e.g., @platformatic/kafka)

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

### RabbitMQ — consume and publish spans

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

Publisher:

```ts
import {
  withPublishSpan,
  injectRabbitMQTraceHeaders,
} from 'autotel-plugins/rabbitmq';

await withPublishSpan(
  {
    name: 'order.publish',
    exchange: 'orders',
    routingKey: 'order.created',
    correlationId: orderId,
  },
  async (span) => {
    const headers = injectRabbitMQTraceHeaders(
      {},
      { includeCorrelationIdHeader: true },
    );
    channel.publish('orders', 'order.created', content, { headers });
  },
);
```

### Semantic attribute constants

All plugins export semantic attribute name constants — use these instead of string literals:

```ts
import {
  SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP,
  SEMATTRS_GCP_BIGQUERY_JOB_ID,
} from 'autotel-plugins/kafka';
// or import from 'autotel-plugins' (re-exported from root)
```

## Common Mistakes

### HIGH: Injecting trace headers outside the producer span

Headers must be injected while the producer span is active. Calling `injectTraceHeaders` before `withProducerSpan` captures whatever span is active at call time — not the producer span.

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

Batch fan-in (many messages → one output) should use `'none'` (or `'link'`). Using `'inherit'` picks a single arbitrary message's trace as the parent, silently losing all other upstream spans.

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

Targets autotel-plugins v0.19.4. Optional peer dependencies: `@google-cloud/bigquery >=8.1.1`, `@opentelemetry/instrumentation-kafkajs >=0.22.0`, `@opentelemetry/instrumentation-amqplib >=0.60.0`.
