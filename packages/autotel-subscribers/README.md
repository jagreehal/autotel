# autotel-subscribers

**Send events to multiple platforms**

Subscribers for [autotel](https://github.com/jagreehal/autotel) to send events to PostHog, Mixpanel, Amplitude, Segment, and custom webhooks.

## Why Use This?

**Track once, send everywhere:**
- Primary metrics → **OpenTelemetry** (infrastructure monitoring)
- Product events → **PostHog / Mixpanel / Amplitude**
- Customer data → **Segment**
- Custom integrations → **Webhooks** (Zapier, Make.com, etc.)

**Zero overhead when not used:**
Adapters are optional. If you don't use them, they're tree-shaken out (0 bytes).

---

## Building Custom Subscribers

Two base classes available:

### `EventSubscriber` - Standard Base Class

Use for most custom subscribers. Provides production-ready features:

- Error handling (automatic catching + custom handlers)
- Pending request tracking (ensures delivery during shutdown)
- Graceful shutdown (drains pending requests)
- Enable/disable control (runtime toggle)

**When to use:** Any custom adapter (HTTP APIs, databases, webhooks, etc.)

```typescript
import { EventSubscriber, EventPayload } from 'autotel-subscribers';

class MySubscriber extends EventSubscriber {
  readonly name = 'MySubscriber';

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    // Send to your platform
    await fetch('https://api.example.com/events', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
}
```

### `StreamingEventSubscriber` - For High-Throughput Streams

Extends `EventSubscriber` with batching and partitioning for streaming platforms.

**When to use:** Kafka, Kinesis, Pub/Sub, event streams, high-volume data pipelines

```typescript
import { StreamingEventSubscriber } from 'autotel-subscribers';

class KafkaSubscriber extends StreamingEventSubscriber {
  readonly name = 'KafkaSubscriber';

  protected async sendBatch(events: EventPayload[]): Promise<void> {
    await this.producer.send({
      topic: 'events',
      messages: events.map(e => ({ value: JSON.stringify(e) }))
    });
  }
}
```

---

## Installation

```bash
# Core package (required)
pnpm add autotel

# Subscribers package (optional)
pnpm add autotel-subscribers

# Install the events SDKs you need
pnpm add posthog-node      # For PostHog
pnpm add mixpanel          # For Mixpanel
pnpm add @segment/events-node  # For Segment
pnpm add @amplitude/events-node  # For Amplitude
```

---

## Quick Start

### Using Built-in Subscribers (Easiest)

Import subscribers directly from their entry points:

```typescript
import { Events } from 'autotel/events';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';
import { WebhookSubscriber } from 'autotel-subscribers/webhook';

const events = new Event('checkout', {
  subscribers: [
    new PostHogSubscriber({ apiKey: process.env.POSTHOG_API_KEY! }),
    new WebhookSubscriber({ url: 'https://your-webhook.com' })
  ]
});

// Sent to: OpenTelemetry + PostHog + Webhook
events.trackEvent('order.completed', { userId: '123', amount: 99.99 });
```

### Your First Custom Subscriber (5 Minutes)

Create an adapter in 25 lines:

```typescript
import { EventSubscriber, EventPayload } from 'autotel-subscribers';

class MySubscriber extends EventSubscriber {
  readonly name = 'MySubscriber';

  constructor(private apiKey: string) {
    super();
  }

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    await fetch('https://your-api.com/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  }
}

// Use it!
const events = new Event('my-app', {
  subscribers: [new MySubscriber('your-api-key')]
});
```

**That's it!** Extend `EventSubscriber` and implement `sendToDestination()`. You get error handling, graceful shutdown, and pending request tracking automatically. See [Your First Adapter Guide](./docs/your-first-subscriber.md) for details.

### Test Your Adapter

```typescript
import { AdapterTestHarness } from 'autotel-subscribers/testing';

const harness = new AdapterTestHarness(new MySubscriber('test-key'));
const results = await harness.runAll();

AdapterTestHarness.printResults(results);
// All tests passed! Your adapter is ready to use.
```

### Add Middleware (Retry, Sampling, etc.)

```typescript
import { applyMiddleware, retryMiddleware, samplingMiddleware } from 'autotel-subscribers/middleware';

const subscriber = applyMiddleware(
  new MySubscriber('api-key'),
  [
    retryMiddleware({ maxRetries: 3 }),  // Retry failed requests
    samplingMiddleware(0.1)               // Only send 10% of events
  ]
);
```

---

## Built-in Adapters

### PostHog

```typescript
import { Events } from 'autotel/events';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';

const events = new Event('checkout', {
  subscribers: [
    new PostHogSubscriber({
      apiKey: process.env.POSTHOG_API_KEY!,
      host: 'https://us.i.posthog.com' // optional
    })
  ]
});

// Sent to: OpenTelemetry + PostHog
events.trackEvent('order.completed', {
  userId: '123',
  amount: 99.99
});
```

**Serverless Configuration (AWS Lambda, Vercel, Next.js):**

```typescript
const subscriber = new PostHogSubscriber({
  apiKey: 'phc_...',
  serverless: true,  // Auto-configures for serverless (flushAt: 1, flushInterval: 0)
});
```

**Browser Usage (with global PostHog client):**

```typescript
// When PostHog is already loaded via script tag
const subscriber = new PostHogSubscriber({
  useGlobalClient: true,  // Uses window.posthog
});
```

**Advanced Options:**

```typescript
const subscriber = new PostHogSubscriber({
  apiKey: 'phc_...',

  // Automatic filtering (enabled by default)
  filterUndefinedValues: true,  // Removes undefined/null from attributes

  // Enhanced error handling
  onErrorWithContext: (ctx) => {
    console.error(`${ctx.eventType} failed: ${ctx.eventName}`, ctx.error);
    Sentry.captureException(ctx.error, { extra: ctx });
  },
});
```

**Custom Funnel Tracking:**

```typescript
// Track custom step names (not limited to 'started'/'completed')
event.trackFunnelProgression('checkout', 'cart_viewed', 1);
event.trackFunnelProgression('checkout', 'shipping_selected', 2);
event.trackFunnelProgression('checkout', 'payment_entered', 3);
```

### Mixpanel

```typescript
import { MixpanelSubscriber } from 'autotel-subscribers/mixpanel';

const events = new Event('checkout', {
  subscribers: [
    new MixpanelSubscriber({
      token: process.env.MIXPANEL_TOKEN!
    })
  ]
});
```

### Segment

```typescript
import { SegmentSubscriber } from 'autotel-subscribers/segment';

const events = new Event('checkout', {
  subscribers: [
    new SegmentSubscriber({
      writeKey: process.env.SEGMENT_WRITE_KEY!
    })
  ]
});
```

### Amplitude

```typescript
import { AmplitudeSubscriber } from 'autotel-subscribers/amplitude';

const events = new Event('checkout', {
  subscribers: [
    new AmplitudeSubscriber({
      apiKey: process.env.AMPLITUDE_API_KEY!
    })
  ]
});
```

### Webhook (Custom Integrations)

```typescript
import { WebhookSubscriber } from 'autotel-subscribers/webhook';

const events = new Event('checkout', {
  subscribers: [
    new WebhookSubscriber({
      url: 'https://hooks.zapier.com/hooks/catch/...',
      headers: { 'X-API-Key': 'secret' },
      maxRetries: 3
    })
  ]
});
```

---

## Multi-Platform Tracking

Send to **multiple platforms simultaneously**:

```typescript
import { Events } from 'autotel/events';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';
import { MixpanelSubscriber } from 'autotel-subscribers/mixpanel';
import { SegmentSubscriber } from 'autotel-subscribers/segment';

const events = new Event('checkout', {
  subscribers: [
    new PostHogSubscriber({ apiKey: 'phc_...' }),
    new MixpanelSubscriber({ token: '...' }),
    new SegmentSubscriber({ writeKey: '...' })
  ]
});

// Sent to: OpenTelemetry + PostHog + Mixpanel + Segment
events.trackEvent('order.completed', { 
  userId: '123', 
  amount: 99.99,
  currency: 'USD'
});
```

---

## Delivery Patterns

Autotel-subscribers provides **direct subscribers** (fire-and-forget) - events are sent immediately to events platforms.

### Direct Subscribers (Default)

**Simple, fire-and-forget tracking** - Events sent immediately to events platforms:

```typescript
const events = new Event('app', {
  subscribers: [new PostHogSubscriber({ apiKey: '...' })]
})

// Events sent immediately, real-time
events.trackEvent('user.signup', { userId: '123' })
events.trackEvent('page.viewed', { path: '/checkout' })
```

**Use for:**
- Page views, button clicks, feature usage
- User behavior tracking
- High-volume, non-critical events
- Real-time events dashboards

**Benefits:**
- Simple, zero infrastructure
- Real-time delivery
- No database overhead
- Fire-and-forget

**Trade-offs:**
- Events can be lost if adapter/network fails
- No atomicity with database transactions

### Transactional Outbox Pattern

**For guaranteed delivery with atomicity**, use the separate [`autotel-outbox`](https://github.com/jagreehal/autotel/tree/main/packages/autotel-outbox) package.

This provides:
- Guaranteed delivery (retries on failure)
- Atomicity with database state changes
- Fan-out to multiple destinations
- Requires database table + publisher worker
- Adds latency (1+ minute delay)

**Install:**
```bash
npm install autotel-outbox
```

**Usage:**
```typescript
import { OutboxEventSubscriber } from 'autotel-outbox';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';

const outbox = new DrizzleD1OutboxStorage(env.DB);
const events = new Event('checkout', {
  subscribers: [
    new OutboxEventSubscriber(outbox, { aggregateType: 'Order' })
  ]
});
```

---

## Adapter Methods

All subscribers implement these methods:

```typescript
interface EventSubscriber {
  // Track events
  trackEvent(name: string, attributes?: Record<string, any>): Promise<void>;

  // Track conversion funnels (enum-based steps)
  trackFunnelStep(
    funnelName: string,
    step: 'started' | 'completed' | 'abandoned' | 'failed',
    attributes?: Record<string, any>
  ): Promise<void>;

  // Track funnel progression (custom step names)
  trackFunnelProgression?(
    funnelName: string,
    stepName: string,         // Any string, not limited to enum
    stepNumber?: number,      // Optional numeric position
    attributes?: Record<string, any>
  ): Promise<void>;

  // Track business outcomes
  trackOutcome(
    operationName: string,
    outcome: 'success' | 'failure' | 'partial',
    attributes?: Record<string, any>
  ): Promise<void>;

  // Track business values (revenue, counts, etc.)
  trackValue(
    name: string,
    value: number,
    attributes?: Record<string, any>
  ): Promise<void>;

  // Flush and clean up resources
  shutdown?(): Promise<void>;
}
```

---

## Custom Subscriber

Create your own adapter for any platform:

```typescript
import { EventSubscriber } from 'autotel/events-adapter';

class MyCustomSubscriber implements EventSubscriber {
  trackEvent(name: string, attributes?: Record<string, any>): void {
    // Send to your platform
    fetch('https://api.myplatform.com/events', {
      method: 'POST',
      body: JSON.stringify({ event: name, ...attributes })
    });
  }
  
  trackFunnelStep(funnel: string, step: string, attributes?: any): void {
    // Implement funnel tracking
  }
  
  trackOutcome(operation: string, outcome: string, attributes?: any): void {
    // Implement outcome tracking
  }
  
  trackValue(name: string, value: number, attributes?: any): void {
    // Implement value tracking
  }
}

// Use it
const events = new Event('app', {
  subscribers: [new MyCustomSubscriber()]
});
```

---

## Configuration

### Enable/Disable Adapters

```typescript
const events = new Event('checkout', {
  subscribers: [
    new PostHogSubscriber({ 
      apiKey: 'phc_...',
      enabled: process.env.NODE_ENV === 'production' // Only in prod
    }),
    new MixpanelSubscriber({ 
      token: '...',
      enabled: false // Temporarily disabled
    })
  ]
});
```

### Shutdown Gracefully

```typescript
const posthog = new PostHogSubscriber({ apiKey: 'phc_...' });
const segment = new SegmentSubscriber({ writeKey: '...' });

// Before app shutdown
await posthog.shutdown();
await segment.shutdown();
```

---

## Tree-Shaking

Adapters are **fully tree-shakeable**:

```typescript
// Only PostHog code is bundled (not Mixpanel, Segment, etc.)
import { PostHogSubscriber } from 'autotel-subscribers/posthog';
```

Bundle sizes (gzipped):
- PostHog: ~8KB
- Mixpanel: ~6KB
- Segment: ~12KB
- Amplitude: ~10KB
- Webhook: ~2KB

---

## Performance

**Zero overhead when not used:**
- If `subscribers: []` (empty), no adapter code runs
- Tree-shaken out in production builds

**Minimal overhead when used:**
- Adapters only fire if added to the array
- Non-blocking (fire-and-forget)
- No impact on primary OpenTelemetry metrics

---

## Middleware (Composition Patterns)

Add behaviors without modifying adapter code:

### Available Middleware

```typescript
import {
  applyMiddleware,
  retryMiddleware,          // Exponential backoff retry
  samplingMiddleware,       // Send only X% of events
  enrichmentMiddleware,     // Add fields to events
  loggingMiddleware,        // Debug events
  filterMiddleware,         // Only send matching events
  transformMiddleware,      // Transform events
  batchingMiddleware,       // Batch for efficiency
  rateLimitMiddleware,      // Throttle requests
  circuitBreakerMiddleware, // Prevent cascading failures
  timeoutMiddleware         // Add timeouts
} from 'autotel-subscribers/middleware';
```

### Examples

**Retry with Circuit Breaker:**
```typescript
const subscriber = applyMiddleware(
  new PostHogSubscriber({ apiKey: '...' }),
  [
    retryMiddleware({ maxRetries: 3, delayMs: 1000 }),
    circuitBreakerMiddleware({ failureThreshold: 5, timeout: 60000 })
  ]
);
```

**Sample Events (Reduce Costs):**
```typescript
// Only send 10% of events
const subscriber = applyMiddleware(
  new WebhookSubscriber({ url: '...' }),
  [samplingMiddleware(0.1)]
);
```

**Enrich Events:**
```typescript
const subscriber = applyMiddleware(
  adapter,
  [
    enrichmentMiddleware((event) => ({
      ...event,
      attributes: {
        ...event.attributes,
        environment: process.env.NODE_ENV,
        timestamp: Date.now()
      }
    }))
  ]
);
```

**Batch Events:**
```typescript
const subscriber = applyMiddleware(
  adapter,
  [batchingMiddleware({ batchSize: 100, flushInterval: 5000 })]
);
```

---

## Testing Custom Subscribers

### AdapterTestHarness

Validate your adapter works correctly:

```typescript
import { AdapterTestHarness } from 'autotel-subscribers/testing';

const harness = new AdapterTestHarness(new MySubscriber());
const results = await harness.runAll();

if (results.passed) {
  console.log('All tests passed!');
} else {
  console.error('Tests failed:', results.failures);
}

// Or use the built-in printer
AdapterTestHarness.printResults(results);
```

Tests include:
- Basic event tracking
- Funnel tracking
- Outcome tracking
- Value tracking
- Concurrent requests (50 events)
- Error handling
- Graceful shutdown

### MockWebhookServer

Test webhook subscribers without real HTTP calls:

```typescript
import { MockWebhookServer } from 'autotel-subscribers/testing';

const server = new MockWebhookServer();
const url = await server.start();

const subscriber = new WebhookSubscriber({ url });
await subscriber.trackEvent('test', { foo: 'bar' });

// Assert
const requests = server.getRequests();
expect(requests).toHaveLength(1);
expect(requests[0].body.event).toBe('test');

await server.stop();
```

---

## Package Exports

All exports available:

```typescript
// Import subscribers from their specific entry points
import { PostHogSubscriber } from 'autotel-subscribers/posthog';
import { MixpanelSubscriber } from 'autotel-subscribers/mixpanel';
import { SegmentSubscriber } from 'autotel-subscribers/segment';
import { AmplitudeSubscriber } from 'autotel-subscribers/amplitude';
import { WebhookSubscriber } from 'autotel-subscribers/webhook';
import { SlackSubscriber } from 'autotel-subscribers/slack';

// Base classes for building custom subscribers
import { EventSubscriber, EventPayload } from 'autotel-subscribers';
import { StreamingEventSubscriber } from 'autotel-subscribers';

// Middleware (composition)
import {
  applyMiddleware,
  retryMiddleware,
  samplingMiddleware,
  /* ... 8 more middleware functions */
} from 'autotel-subscribers/middleware';

// Testing utilities
import {
  AdapterTestHarness,
  MockWebhookServer,
  MockEventSubscriber
} from 'autotel-subscribers/testing';

// For outbox pattern, see autotel-outbox package
```

---

## Resources

- [Your First Adapter Guide](./docs/your-first-subscriber.md) - Create a custom adapter in 5 minutes
- [Quickstart Template](./examples/quickstart-custom-subscriber.ts) - Copy-paste 20-line template
- [Testing Guide](./docs/your-first-subscriber.md#test-your-adapter) - Validate your adapter works
- [Middleware Guide](./docs/your-first-subscriber.md#add-superpowers-with-middleware) - Add retry, sampling, etc.
- [Outbox Pattern](/packages/autotel-outbox/) - For transactional outbox pattern

---

## Examples

See the [autotel-examples](https://github.com/jagreehal/autotel/tree/main/packages/autotel-examples) package for complete examples.

---

## License

MIT © [Jag Reehal](https://jagreehal.com)


