# autotel-kafka

Kafka observability for [autotel](../autotel). The official
`@opentelemetry/instrumentation-kafkajs` traces produce and consume calls.
`autotel-kafka` adds the spans around your own code:

- **Processing spans** with trace context from message headers, as a parent or
  a link (`withProcessingSpan`)
- **Producer spans** that inject `traceparent` and a correlation ID into the
  message (`withProducerSpan`, `injectTraceHeaders`)
- **Batch spans** for `eachBatch`, with optional per-message spans
  (`withBatchConsumer`)
- **Batch lineage**: one span linked to every upstream trace in a batch
  (`extractBatchLineage`)
- **Consumer metrics**, including consumer lag (`ConsumerMetrics`)
- **Consumer group events**: joins, rebalances, crashes and disconnects, with
  each member's partition count (`instrumentConsumerEvents`)
- **Stream processors**: a span per stage, and output messages linked to the
  input (`createStreamProcessor`)

```bash
npm install autotel autotel-kafka kafkajs
# optional, for the client's own produce/consume spans
npm install @opentelemetry/instrumentation-kafkajs
```

## Consumer

```typescript
import { withProcessingSpan } from 'autotel-kafka';

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    await withProcessingSpan(
      {
        name: 'order.process',
        headers: message.headers,
        contextMode: 'inherit', // 'inherit' | 'link' | 'none'
        topic,
        consumerGroup: 'payments',
        partition,
        offset: message.offset,
      },
      async (span) => processOrder(message),
    );
  },
});
```

| `contextMode` | Parent                                                       | Link to the producer         |
| ------------- | ------------------------------------------------------------ | ---------------------------- |
| `inherit`     | The producer's context, or the active span when there is one | When it is a different trace |
| `link`        | The current context                                          | Always                       |
| `none`        | The current context                                          | Never                        |

## Producer

Inject the headers inside the producer span, so consumers pick up its context:

```typescript
import { withProducerSpan, injectTraceHeaders } from 'autotel-kafka';

await withProducerSpan(
  { name: 'order.publish', topic: 'orders', messageKey: orderId },
  async () => {
    const headers = injectTraceHeaders({});
    await producer.send({
      topic: 'orders',
      messages: [{ key: orderId, value: JSON.stringify(order), headers }],
    });
  },
);
```

## Batch consumer

`withBatchConsumer` keeps the KafkaJS `eachBatch` signature. With
`perMessageSpans: 'all'`, each message gets a span that continues the trace in
its headers, or sits under the batch span when it has none. `'errors'` creates
a span only for the message that failed.

```typescript
import { withBatchConsumer } from 'autotel-kafka';

await consumer.run({
  eachBatch: withBatchConsumer(
    {
      name: 'orders.batch',
      consumerGroup: 'processor',
      perMessageSpans: 'all',
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

## Batch lineage

When one span is the result of many messages, link it to each of their traces:

```typescript
import { extractBatchLineage, withProcessingSpan } from 'autotel-kafka';

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
  async () => processSettlement(batch),
);
```

## Consumer group events

```typescript
import { instrumentConsumerEvents } from 'autotel-kafka';

const stop = instrumentConsumerEvents(consumer, {
  traceRebalances: true,
  traceErrors: true,
});
```

Each group join records `messaging.kafka.consumer.assignment_count`, so a
member with no partitions shows `0`. Pass a `lifecycleSpan` to record the
events on that span instead of one span each.

## Headers from other clients

`normalizeHeaders` accepts KafkaJS records and `Map` headers (for example
`@platformatic/kafka`), with `Buffer` or string values.

## Example

[`apps/example-kafka`](../../apps/example-kafka) runs a live match feed on
Kafka 4.4: fan-out to three consumer groups, ordering, a retry topic and DLQ,
redelivery, a hot partition and an idle consumer, each with the spans it
produces.

## Moving from `autotel-plugins/kafka`

`autotel-plugins/kafka` re-exports this package. Change the import to
`autotel-kafka`; the API is the same.

## License

Apache-2.0
