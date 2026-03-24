# Autotel Plugins

OpenTelemetry instrumentation for libraries **without official support** OR where the official support is fundamentally broken.

## Philosophy

**autotel-plugins only includes instrumentation that:**

1. **Has NO official OpenTelemetry package** (e.g., BigQuery)
2. **Has BROKEN official instrumentation**
3. **Adds significant value** beyond official packages

**We do NOT include:**

- Re-exports of official packages
- Wrappers that add no value
- Duplicates of working official packages

## Why This Approach?

With the `--import` pattern (Node.js 18.19+), using official OpenTelemetry packages **when they work** is simple:

```javascript
// instrumentation.mjs
import { init } from 'autotel';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

init({
  service: 'my-app',
  instrumentations: [new PgInstrumentation()],
});
```

```bash
# Run with --import flag
tsx --import ./instrumentation.mjs src/index.ts
```

**Benefits of official packages (when they work):**

- ✅ Always up-to-date (maintained by OpenTelemetry)
- ✅ Complete feature coverage
- ✅ Battle-tested in production
- ✅ Zero maintenance burden
- ✅ More discoverable and trustworthy

## When to Use Official Packages

For databases/ORMs with **working** official instrumentation, **use those directly**:

- **MongoDB** → [`@opentelemetry/instrumentation-mongodb`](https://www.npmjs.com/package/@opentelemetry/instrumentation-mongodb)
- **PostgreSQL** → [`@opentelemetry/instrumentation-pg`](https://www.npmjs.com/package/@opentelemetry/instrumentation-pg)
- **MySQL** → [`@opentelemetry/instrumentation-mysql2`](https://www.npmjs.com/package/@opentelemetry/instrumentation-mysql2)
- **Redis** → [`@opentelemetry/instrumentation-redis`](https://www.npmjs.com/package/@opentelemetry/instrumentation-redis)
- **Express** → [`@opentelemetry/instrumentation-express`](https://www.npmjs.com/package/@opentelemetry/instrumentation-express)
- **Fastify** → [`@opentelemetry/instrumentation-fastify`](https://www.npmjs.com/package/@opentelemetry/instrumentation-fastify)

[Browse all official instrumentations →](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node)

## Installation

Install the package and **autotel** (required for all plugins):

```bash
npm install autotel autotel-plugins
```

### What to install per plugin

Each plugin needs the core packages above plus the library (and optional OTel instrumentation) you use:

| Plugin       | Install                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **BigQuery** | `autotel` + `autotel-plugins` + `@google-cloud/bigquery`                                                                   |
| **Kafka**    | `autotel` + `autotel-plugins` + `kafkajs`. Optional: `@opentelemetry/instrumentation-kafkajs` for producer/consumer spans. |

Examples:

```bash
# BigQuery
npm install autotel autotel-plugins @google-cloud/bigquery

# Kafka (with optional official instrumentation)
npm install autotel autotel-plugins kafkajs @opentelemetry/instrumentation-kafkajs
```

## Currently Supported

### Kafka

Composition layer for KafkaJS: processing span wrapper, producer span wrapper, batch lineage for fan-in trace correlation, and batch consumer wrapper. Works alongside optional `@opentelemetry/instrumentation-kafkajs` for producer/consumer spans.

**Batch consumer:** Wrap KafkaJS `eachBatch` with `withBatchConsumer(config, handler)`. Preserves the exact KafkaJS payload signature. Config: `name`, `consumerGroup`, `perMessageSpans` (`'none'` | `'all'` | `'errors'`), `onProgress`.

**Per-message spans:**

- **`'all'`** : One span per message. Message spans are parented to **extracted trace context from message headers when valid** (trace continuation); otherwise to the **batch span**. All per-message spans are ended when the batch completes, including skipped or unresolved messages (no span leak).
- **`'errors'`** : Per-message span only on failure. When the handler throws, an error span is created for the first message. Use `createMessageErrorSpan` in your catch block for per-message error spans.

```typescript
import { withBatchConsumer } from 'autotel-plugins/kafka';

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

Optional: install `@opentelemetry/instrumentation-kafkajs` for producer/consumer spans.

## Combining with Official Packages

Mix autotel-plugins with official OpenTelemetry instrumentations:

```typescript
import { init } from 'autotel';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

init({
  service: 'my-service',
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new PgInstrumentation(), // Official packages
  ],
});
```

## Creating Your Own Instrumentation

Don't see your library here? Autotel makes it easy to create custom instrumentation for any library using simple, well-tested utilities.

### Quick Example

```typescript
import { trace, SpanKind } from '@opentelemetry/api';
import { runWithSpan, finalizeSpan } from 'autotel/trace-helpers';

const INSTRUMENTED_FLAG = Symbol('instrumented');

export function instrumentMyLibrary(client) {
  if (client[INSTRUMENTED_FLAG]) return client;

  const tracer = trace.getTracer('my-library');
  const originalMethod = client.someMethod.bind(client);

  client.someMethod = async function (...args) {
    const span = tracer.startSpan('operation', { kind: SpanKind.CLIENT });
    span.setAttribute('operation.param', args[0]);

    try {
      const result = await runWithSpan(span, () => originalMethod(...args));
      finalizeSpan(span);
      return result;
    } catch (error) {
      finalizeSpan(span, error);
      throw error;
    }
  };

  client[INSTRUMENTED_FLAG] = true;
  return client;
}
```

### Full Guide

For a comprehensive guide including:

- Step-by-step tutorial with real examples
- Best practices for security and idempotency
- Complete utilities reference
- Ready-to-use template code

**See: [Creating Custom Instrumentation](../autotel/README.md#creating-custom-instrumentation)** in the main autotel docs.

You can also check [`INSTRUMENTATION_TEMPLATE.ts`](../autotel/INSTRUMENTATION_TEMPLATE.ts) for a fully commented, copy-paste-ready template.

## Contributing

Found a database/ORM without official OpenTelemetry instrumentation? Please [open an issue](https://github.com/jagreehal/autotel/issues) to discuss adding it.

## License

MIT
