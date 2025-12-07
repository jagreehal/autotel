# Bring Your Own System: Extending Autotel Messaging

Autotel's messaging module provides first-class support for common messaging systems like Kafka, SQS, and RabbitMQ. For systems not directly supported, you can use the extensibility hooks to add custom behavior.

## Quick Start: Using Pre-Built Adapters

For several common systems, we provide pre-built adapter configurations:

```typescript
import { traceConsumer, traceProducer } from 'autotel/messaging';
import {
  natsAdapter,
  temporalAdapter,
  cloudflareQueuesAdapter,
} from 'autotel/messaging/adapters';

// NATS JetStream consumer
const processNatsMessage = traceConsumer({
  system: 'nats',
  destination: 'orders.created',
  consumerGroup: 'order-processor',
  ...natsAdapter.consumer,
})((ctx) => async (msg) => {
  // nats.subject, nats.stream, nats.consumer attributes are captured
  await handleOrder(msg.data);
  msg.ack();
});

// Temporal activity
const processTemporalActivity = traceConsumer({
  system: 'temporal',
  destination: 'order-activities',
  ...temporalAdapter.consumer,
})((ctx) => async (info, input) => {
  // temporal.workflow_id, temporal.run_id, temporal.attempt are captured
  return processOrder(input);
});
```

## Available Pre-Built Adapters

| Adapter                   | Producer                        | Consumer                                             | Context Extractor                              |
| ------------------------- | ------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `natsAdapter`             | Subject, reply_to, stream       | Subject, stream, consumer, pending, redelivery_count | -                                              |
| `temporalAdapter`         | Workflow ID, run ID, task queue | Workflow ID, run ID, activity ID, attempt            | -                                              |
| `cloudflareQueuesAdapter` | -                               | Message ID, timestamp, attempts                      | -                                              |
| `datadogContextExtractor` | -                               | -                                                    | Converts Datadog decimal IDs to OTel hex       |
| `b3ContextExtractor`      | -                               | -                                                    | Parses B3/Zipkin single or multi-header format |
| `xrayContextExtractor`    | -                               | -                                                    | Parses AWS X-Ray trace header                  |

## Building Your Own Adapter

### Step 1: Understand the Hook Interfaces

```typescript
interface ProducerAdapter {
  // Add system-specific span attributes
  customAttributes?: (
    ctx: ProducerContext,
    args: unknown[],
  ) => Record<string, AttributeValue>;

  // Inject custom headers (beyond W3C traceparent)
  customHeaders?: (ctx: ProducerContext) => Record<string, string>;
}

interface ConsumerAdapter {
  // Extract headers from message for trace context
  headersFrom?: (msg: unknown) => Record<string, string> | undefined;

  // Add system-specific span attributes
  customAttributes?: (
    ctx: ConsumerContext,
    msg: unknown,
  ) => Record<string, AttributeValue>;

  // Parse non-W3C trace context formats
  customContextExtractor?: (
    headers: Record<string, string>,
  ) => SpanContext | null;
}
```

### Step 2: Create Your Adapter

Example: Redis Streams adapter

```typescript
// my-adapters.ts
import type { AttributeValue } from '@opentelemetry/api';
import type { ProducerContext, ConsumerContext } from 'autotel/messaging';

interface RedisStreamMessage {
  id: string;
  stream: string;
  fields: Record<string, string>;
  consumer?: string;
  pending?: number;
}

export const redisStreamsAdapter = {
  producer: {
    customAttributes: (_ctx: ProducerContext, args: unknown[]) => {
      const [stream, fields] = args as [string, Record<string, string>];
      const attrs: Record<string, AttributeValue> = {};

      if (stream) attrs['redis.stream'] = stream;
      if (fields?.messageType) attrs['redis.message_type'] = fields.messageType;

      return attrs;
    },
  },
  consumer: {
    headersFrom: (msg: unknown) => {
      const redisMsg = msg as RedisStreamMessage;
      // Redis Streams can store trace headers in message fields
      return {
        traceparent: redisMsg.fields?.traceparent,
        tracestate: redisMsg.fields?.tracestate,
      };
    },
    customAttributes: (_ctx: ConsumerContext, msg: unknown) => {
      const redisMsg = msg as RedisStreamMessage;
      const attrs: Record<string, AttributeValue> = {};

      if (redisMsg.id) attrs['redis.message_id'] = redisMsg.id;
      if (redisMsg.stream) attrs['redis.stream'] = redisMsg.stream;
      if (redisMsg.consumer) attrs['redis.consumer'] = redisMsg.consumer;
      if (redisMsg.pending !== undefined)
        attrs['redis.pending'] = redisMsg.pending;

      return attrs;
    },
  },
};
```

### Step 3: Use Your Adapter

```typescript
import { traceConsumer, traceProducer } from 'autotel/messaging';
import { redisStreamsAdapter } from './my-adapters';

export const publishToStream = traceProducer({
  system: 'redis',
  destination: 'order-events',
  ...redisStreamsAdapter.producer,
})((ctx) => async (stream: string, fields: Record<string, string>) => {
  const headers = ctx.getTraceHeaders();
  await redis.xadd(stream, '*', { ...fields, ...headers });
});

export const processStreamMessage = traceConsumer({
  system: 'redis',
  destination: 'order-events',
  consumerGroup: 'order-processor',
  ...redisStreamsAdapter.consumer,
})((ctx) => async (msg: RedisStreamMessage) => {
  await handleMessage(msg.fields);
});
```

## Custom Context Extractors

When your producer uses a non-W3C trace format, create a custom context extractor:

```typescript
import { TraceFlags, type SpanContext } from '@opentelemetry/api';

// Example: Custom trace format with base64-encoded context
export function customB64ContextExtractor(
  headers: Record<string, string>,
): SpanContext | null {
  const encoded = headers['x-custom-trace'];
  if (!encoded) return null;

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [traceId, spanId, sampled] = decoded.split(':');

    if (!traceId || !spanId) return null;

    return {
      traceId: traceId.padStart(32, '0'),
      spanId: spanId.padStart(16, '0'),
      traceFlags: sampled === '1' ? TraceFlags.SAMPLED : TraceFlags.NONE,
      isRemote: true,
    };
  } catch {
    return null;
  }
}

// Usage
const processMessage = traceConsumer({
  system: 'custom',
  destination: 'events',
  customContextExtractor: customB64ContextExtractor,
})((ctx) => async (msg) => {
  // Parent span from custom format is linked
});
```

## Best Practices

### 1. Keep Attributes Focused

Only capture attributes that provide observability value:

```typescript
// Good: Operational attributes
customAttributes: (_ctx, msg) => ({
  'redis.stream': msg.stream,
  'redis.pending': msg.pending,
  'redis.idle_time_ms': msg.idleTime,
});

// Avoid: High-cardinality or PII
customAttributes: (_ctx, msg) => ({
  'redis.message_body': JSON.stringify(msg.fields), // Too much data
  'redis.user_email': msg.fields.email, // PII
});
```

### 2. Handle Missing Data Gracefully

```typescript
customAttributes: (_ctx, msg) => {
  const attrs: Record<string, AttributeValue> = {};

  // Only add if present
  if (msg.id) attrs['custom.id'] = msg.id;
  if (msg.timestamp !== undefined) attrs['custom.timestamp'] = msg.timestamp;

  return attrs;
},
```

### 3. Support Multiple Header Interfaces

Different versions of a messaging library may expose headers differently:

```typescript
headersFrom: (msg) => {
  const headers = msg.headers;
  if (!headers) return;

  // Try object-style first
  if (typeof headers.toJSON === 'function') {
    return headers.toJSON();
  }

  // Fallback to .get() method
  if (typeof headers.get === 'function') {
    return {
      traceparent: headers.get('traceparent'),
      tracestate: headers.get('tracestate'),
    };
  }

  // Fallback to iteration
  if (typeof headers.entries === 'function') {
    const result: Record<string, string> = {};
    for (const [key, value] of headers.entries()) {
      result[key] = value;
    }
    return result;
  }

  return;
},
```

### 4. Test Your Adapter

```typescript
import { describe, it, expect } from 'vitest';
import { myAdapter } from './my-adapters';

describe('myAdapter', () => {
  describe('consumer.customAttributes', () => {
    it('should extract expected attributes', () => {
      const msg = { id: '123', stream: 'orders' };
      const ctx = {} as ConsumerContext; // Mock as needed

      const attrs = myAdapter.consumer.customAttributes!(ctx, msg);

      expect(attrs['custom.id']).toBe('123');
      expect(attrs['custom.stream']).toBe('orders');
    });

    it('should handle missing fields gracefully', () => {
      const msg = {};
      const ctx = {} as ConsumerContext;

      const attrs = myAdapter.consumer.customAttributes!(ctx, msg);

      expect(attrs).toEqual({});
    });
  });
});
```

## Contributing Adapters

If you've built an adapter for a common messaging system, consider contributing it to `autotel/messaging/adapters`. Requirements:

1. Complete producer and/or consumer hooks
2. Unit tests with good coverage
3. JSDoc documentation with usage examples
4. Follow existing naming conventions
