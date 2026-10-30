---
name: autotel-kafka
description: >
  Use this skill when tracing KafkaJS producers and consumers with autotel — processing and producer spans with trace context from headers, eachBatch spans, batch lineage for fan-in, correlation IDs, consumer lag metrics and consumer group events.
---

# autotel-kafka

Kafka observability for autotel. The official `@opentelemetry/instrumentation-kafkajs` traces produce and consume calls; `autotel-kafka` adds the spans around your handler: processing spans with trace context from message headers, `eachBatch` spans, batch lineage, correlation IDs, consumer lag metrics and consumer group events.

## Setup

```bash
pnpm add autotel autotel-kafka kafkajs
# optional, for the client's own produce/consume spans
pnpm add @opentelemetry/instrumentation-kafkajs
```

## Configuration / Core Patterns

### processing spans

Use `withProcessingSpan` to wrap each message handler. This is the core primitive. It creates a CONSUMER-kind span with proper messaging attributes and context propagation.

```ts
import { withProcessingSpan } from 'autotel-kafka';

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

### producer spans

```ts
import { withProducerSpan, injectTraceHeaders } from 'autotel-kafka';

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

### batch processing

For `eachBatch` handlers, `withBatchConsumer` creates a batch-level span and optionally per-message child spans:

```ts
import { withBatchConsumer } from 'autotel-kafka';

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

### batch lineage (fan-in)

When a single downstream span is the result of many upstream messages (e.g., settlement batching), use `extractBatchLineage` to create span links for each upstream trace:

```ts
import {
  extractBatchLineage,
  withProcessingSpan,
  SEMATTRS_LINKED_TRACE_ID_COUNT,
  SEMATTRS_LINKED_TRACE_ID_HASH,
} from 'autotel-kafka';

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

### Map-based headers (e.g., @platformatic/kafka)

```ts
import { normalizeHeaders, withProcessingSpan } from 'autotel-kafka';

// normalizeHeaders accepts Map<string, Buffer | string> or Record<string, ...>
const headers = normalizeHeaders(message.headers);

await withProcessingSpan(
  { name: 'order.process', headers, contextMode: 'inherit', topic },
  async () => {
    await processOrder(message);
  },
);
```

### Consumer group events

`instrumentConsumerEvents` records KafkaJS group joins, rebalances, crashes and disconnects. Each group join records the member's `messaging.kafka.consumer.assignment_count`, so a member left without a partition shows up as `0`.

```ts
import { instrumentConsumerEvents } from 'autotel-kafka';

const stop = instrumentConsumerEvents(consumer, {
  traceRebalances: true,
  traceErrors: true,
});
```

Pass a `lifecycleSpan` to record the events on that span instead of one span each.

### Semantic attribute constants

```ts
import { SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP } from 'autotel-kafka';
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

### MEDIUM: Importing from `autotel-plugins/kafka`

`autotel-plugins/kafka` re-exports `autotel-kafka` and is deprecated. Import from `autotel-kafka`.

## Version

Targets autotel-kafka v0.1.0. Optional peer dependency: `@opentelemetry/instrumentation-kafkajs >=0.32.0`.
