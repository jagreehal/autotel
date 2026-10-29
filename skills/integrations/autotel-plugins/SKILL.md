---
name: autotel-plugins
description: >
  Use this skill when instrumenting BigQuery or RabbitMQ with OpenTelemetry — plugins for libraries with no official OTel support (BigQuery) or where the official package lacks processing spans, ack tracking, batch lineage and correlation IDs (RabbitMQ). For Kafka, use autotel-kafka.
---

# autotel-plugins

Instrumentation plugins for libraries that have no official OTel support or where official support is incomplete. Two plugins ship in this package. Kafka moved to its own package, [`autotel-kafka`](../autotel-kafka/SKILL.md); `autotel-plugins/kafka` re-exports it and is deprecated.

| Plugin   | Subpath                    | Use case                                                                                                                      |
| -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| BigQuery | `autotel-plugins/bigquery` | No official OTel instrumentation exists                                                                                       |
| RabbitMQ | `autotel-plugins/rabbitmq` | Composition layer on top of `@opentelemetry/instrumentation-amqplib`: adds consume/publish spans, ack tracking, batch lineage |

Both are also re-exported from the root `autotel-plugins` entry point, along with the deprecated Kafka exports. RabbitMQ helpers whose names clash with Kafka's are renamed there (`injectRabbitMQTraceHeaders`, `extractRabbitMQBatchLineage`, `normalizeRabbitMQHeaders`, ...); on the `/rabbitmq` subpath they keep the plain names.

## Setup

Install the package plus the relevant peer dependency for your plugin:

```bash
# BigQuery
pnpm add autotel-plugins @google-cloud/bigquery

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

### RabbitMQ: consume and publish spans

RabbitMQ mirrors the `autotel-kafka` API surface, for AMQP:

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
import { SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT } from 'autotel-plugins/rabbitmq';
// BigQuery and DB constants are only on the root entry:
import { SEMATTRS_GCP_BIGQUERY_JOB_ID } from 'autotel-plugins';
```

## Common Mistakes

### MEDIUM: Calling `instrumentBigQuery` after queries have already been made

`instrumentBigQuery` wraps the instance methods at call time. Any method calls made before instrumentation are not traced.

Correct: call `instrumentBigQuery` immediately after constructing the `BigQuery` instance, before making any queries.

### MEDIUM: Importing from root when only one plugin is needed

The root `autotel-plugins` entry re-exports every plugin. If your bundle tree-shakes poorly or you want to be explicit, import from the subpath:

```ts
// Preferred when only using RabbitMQ
import { withConsumeSpan } from 'autotel-plugins/rabbitmq';

// Root import is fine but includes all plugin code
import { withConsumeSpan } from 'autotel-plugins';
```

## Version

Targets autotel-plugins v0.21.13. Optional peer dependencies: `@google-cloud/bigquery >=9.3.0`, `@opentelemetry/instrumentation-amqplib >=0.70.0`.
