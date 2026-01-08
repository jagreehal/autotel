# Advanced Features (v1.1.0+)

Advanced features and capabilities for power users.

## Deterministic Trace IDs

Generate consistent trace IDs from seeds for correlation with external systems:

```typescript
import { createDeterministicTraceId } from 'autotel/trace-helpers';

// Generate trace ID from external request ID
const requestId = req.headers['x-request-id'];
const traceId = await createDeterministicTraceId(requestId);

// Use for correlation in support tickets, external systems, etc.
console.log(`View traces: https://your-backend.com/traces/${traceId}`);
```

**Implementation:** Uses SHA-256 hashing to generate consistent 128-bit trace IDs. Works in Node.js and edge runtimes (via crypto.subtle).

**Use cases:**

- Correlate external request IDs with OTel traces
- Link support tickets to trace data
- Associate business entities (orders, sessions) with observability data

## Metadata Flattening

Automatically flatten nested objects into dot-notation span attributes:

```typescript
import { flattenMetadata } from 'autotel/trace-helpers';
import { trace } from 'autotel';

export const processOrder = trace((ctx) => async (order: Order) => {
  const metadata = flattenMetadata({
    user: { id: order.userId, tier: 'premium' },
    payment: { method: 'card', processor: 'stripe' },
    items: order.items.length,
  });

  ctx.setAttributes(metadata);
  // Results in: metadata.user.id, metadata.user.tier, metadata.payment.method, etc.
});
```

**Features:**

- Auto-serializes non-string values to JSON
- Filters out null/undefined values
- Gracefully handles circular references (→ `<serialization-failed>`)
- Customizable prefix (default: `'metadata'`)

## Isolated Tracer Provider

For library authors who want to use Autotel without interfering with the application's global OTel setup:

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { setAutotelTracerProvider } from 'autotel/tracer-provider';

// Create isolated provider (don't call provider.register())
const exporter = new OTLPTraceExporter({
  url: 'https://your-backend.com/v1/traces',
});
const provider = new NodeTracerProvider();
provider.addSpanProcessor(new BatchSpanProcessor(exporter));

// Set as Autotel's provider (isolated from global OTel)
setAutotelTracerProvider(provider);

// Now all trace(), span(), instrument() calls use this provider
```

**Important limitations:**

- Isolates span processing and export only
- OpenTelemetry context (trace IDs, parent spans) is still shared globally
- Spans from isolated provider may inherit context from global spans

**Use cases:**

- Library code with embedded Autotel
- SDKs that need observability without forcing users to configure OTel
- Separate span processing for different subsystems
- Testing with isolated trace collection

## Semantic Convention Helpers

Pre-configured trace helpers following OpenTelemetry semantic conventions:

```typescript
import {
  traceLLM,
  traceDB,
  traceHTTP,
  traceMessaging,
} from 'autotel/semantic-helpers';

// LLM operations (Gen AI semantic conventions)
export const generateText = traceLLM({
  model: 'gpt-4-turbo',
  operation: 'chat',
  provider: 'openai',
})((ctx) => async (prompt: string) => {
  const response = await openai.chat.completions.create({
    /* ... */
  });
  ctx.setAttribute(
    'gen.ai.usage.completion_tokens',
    response.usage.completion_tokens,
  );
  return response.choices[0].message.content;
});

// Database operations (DB semantic conventions)
export const getUser = traceDB({
  system: 'postgresql',
  operation: 'SELECT',
  database: 'app_db',
  collection: 'users',
})((ctx) => async (userId: string) => {
  const query = 'SELECT * FROM users WHERE id = $1';
  ctx.setAttribute('db.statement', query);
  return await pool.query(query, [userId]);
});

// HTTP client operations (HTTP semantic conventions)
export const fetchUser = traceHTTP({
  method: 'GET',
  url: 'https://api.example.com/users/:id',
})((ctx) => async (userId: string) => {
  const response = await fetch(`https://api.example.com/users/${userId}`);
  ctx.setAttribute('http.response.status_code', response.status);
  return response.json();
});

// Messaging operations (Messaging semantic conventions)
export const publishEvent = traceMessaging({
  system: 'kafka',
  operation: 'publish',
  destination: 'user-events',
})((ctx) => async (event: Event) => {
  await producer.send({ topic: 'user-events', messages: [event] });
  ctx.setAttribute('messaging.message.id', event.id);
});
```

**Benefits:**

- Automatic semantic attributes following OTel specs
- Type-safe configuration interfaces
- Reduces boilerplate by 60-70%
- Links to official OTel semantic convention docs in JSDoc

**Available helpers:**

- `traceLLM()` - Gen AI operations (chat, completion, embedding)
- `traceDB()` - Database operations (SQL, NoSQL, Redis)
- `traceHTTP()` - HTTP client requests
- `traceMessaging()` - Queue/messaging operations (Kafka, RabbitMQ, SQS)

## Event-Driven Observability

First-class support for message-based systems with `traceProducer` and `traceConsumer` helpers:

```typescript
import { traceProducer, traceConsumer } from 'autotel/messaging';

// Producer - auto-sets SpanKind.PRODUCER and semantic attributes
export const publishEvent = traceProducer({
  system: 'kafka', // kafka | sqs | rabbitmq | custom
  destination: 'user-events',
  messageIdFrom: (args) => args[0].id, // Extract message ID
})((ctx) => async (event: Event) => {
  const headers = ctx.getTraceHeaders(); // W3C traceparent/tracestate
  await producer.send({
    topic: 'user-events',
    messages: [{ value: event, headers }],
  });
});

// Consumer - auto-sets SpanKind.CONSUMER, extracts links from headers
export const processEvent = traceConsumer({
  system: 'kafka',
  destination: 'user-events',
  consumerGroup: 'event-processor',
  headersFrom: (msg) => msg.headers, // Extract trace headers
  batchMode: true, // For batch consumers
})((ctx) => async (messages) => {
  // Links to producer spans automatically created
  for (const msg of messages) await process(msg);
});
```

**Key implementation details:**

- Uses `SpanKind.PRODUCER` / `SpanKind.CONSUMER` for proper trace visualization
- `ctx.getTraceHeaders()` returns `{ traceparent, tracestate? }` for header injection
- `ctx.recordDLQ(dlqName, reason)` for dead-letter queue tracking
- Supports lag metrics via `lagMetrics.getCurrentOffset` / `getEndOffset`
- Automatic semantic attributes: `messaging.system`, `messaging.destination.name`, `messaging.operation`, `messaging.consumer.group`

## Safe Baggage Propagation

Type-safe baggage schemas with built-in guardrails for cross-service context:

```typescript
import {
  createSafeBaggageSchema,
  BusinessBaggage,
} from 'autotel/business-baggage';

// Pre-built schema for common fields
BusinessBaggage.set(ctx, {
  tenantId: 'acme',
  userId: 'user-123',
  priority: 'high',
});
const { tenantId, priority } = BusinessBaggage.get(ctx);

// Custom schema with validation and guardrails
const OrderBaggage = createSafeBaggageSchema(
  {
    orderId: { type: 'string', maxLength: 36 },
    customerId: { type: 'string', hash: true }, // Auto-hash for privacy
    tier: { type: 'enum', values: ['free', 'pro', 'enterprise'] as const },
  },
  {
    prefix: 'order', // Keys: order.orderId, order.tier
    redactPII: true, // Auto-redact email/phone/SSN patterns
    hashHighCardinality: true, // Hash UUIDs/timestamps
  },
);
```

**Guardrails:**

- **Size limits**: `maxKeyLength` (default 64), `maxValueLength` (default 256)
- **PII detection**: Regex patterns for email, phone, SSN auto-redacted
- **High-cardinality hashing**: UUIDs and timestamps hashed via FNV-1a
- **Enum validation**: Rejects values not in the defined set
- **Type coercion**: Numbers/booleans properly serialized

## Workflow & Saga Tracing

Track distributed workflows with compensation support:

```typescript
import { traceWorkflow, traceStep } from 'autotel/workflow';

export const orderSaga = traceWorkflow({
  name: 'OrderSaga',
  workflowId: (order) => order.id,
})((ctx) => async (order) => {
  await traceStep({
    name: 'ReserveInventory',
    compensate: async (ctx, error) => {
      await inventoryService.release(order.items); // Rollback
    },
  })((ctx) => async () => {
    await inventoryService.reserve(order.items);
  })();

  await traceStep({
    name: 'ChargePayment',
    linkToPrevious: true, // Link to ReserveInventory span
    compensate: async (ctx, error) => {
      await paymentService.refund(order.id);
    },
  })((ctx) => async () => {
    await paymentService.charge(order);
  })();
});
// If ChargePayment fails, compensations run in reverse order
```

**Key features:**

- `traceWorkflow` creates root span with `workflow.name`, `workflow.id` attributes
- `traceStep` creates child spans with `workflow.step.name`, `workflow.step.index`
- `linkToPrevious: true` creates span links for step sequencing
- Compensations run in reverse order on failure
- `ctx.getWorkflowId()`, `ctx.getWorkflowName()`, `ctx.getStepIndex()` context methods
- WeakMap-based state isolation tied to span lifecycle

