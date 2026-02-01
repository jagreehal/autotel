# Your First Custom Adapter in 5 Minutes

This guide will walk you through creating a custom events adapter from scratch.

## Why Custom Adapters?

autotel-subscribers provides adapters for popular platforms (PostHog, Mixpanel, etc.), but you might need to:
- Send events to an internal system
- Integrate with a platform we don't support yet
- Add custom logic (filtering, transformation, enrichment)

**Good news:** Creating an adapter is dead simple!

---

## Quick Start (Copy-Paste Template)

```typescript
import type { EventsAdapter, EventAttributes } from 'autotel-subscribers';

export class MyFirstAdapter implements EventsAdapter {
  readonly name = 'MyFirstAdapter';

  async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
    console.log('EVENT:', name, attributes);
    // TODO: Replace with your API call
  }

  async trackFunnelStep(funnel: string, step: string, attributes?: EventAttributes): Promise<void> {
    console.log('FUNNEL:', funnel, step, attributes);
  }

  async trackOutcome(operation: string, outcome: string, attributes?: EventAttributes): Promise<void> {
    console.log('OUTCOME:', operation, outcome, attributes);
  }

  async trackValue(name: string, value: number, attributes?: EventAttributes): Promise<void> {
    console.log('VALUE:', name, value, attributes);
  }

  async shutdown(): Promise<void> {
    console.log('SHUTDOWN');
  }
}
```

**That's it!** You just created a working adapter.

---

## Receiving Trace Context (options.autotel)

The `trackEvent` method receives an optional third parameter with trace context:

```typescript
import type { EventsAdapter, EventAttributes, EventTrackingOptions } from 'autotel-subscribers';

export class MyAdapter implements EventsAdapter {
  readonly name = 'MyAdapter';

  async trackEvent(
    name: string,
    attributes?: EventAttributes,
    options?: EventTrackingOptions,  // ← Third parameter
  ): Promise<void> {
    // options?.autotel contains correlation and trace context:
    // - correlation_id (always present, 16 hex chars)
    // - trace_id, span_id (when inside a span)
    // - trace_url (if events.traceUrl is configured)

    // Merge into your payload for request-event correlation:
    const payload = {
      event: name,
      properties: attributes,
      ...options?.autotel,  // Include correlation_id, trace_url, etc.
    };
    await this.sendToBackend(payload);
  }

  private async sendToBackend(payload: unknown): Promise<void> {
    // Your API call here
  }

  // ... implement other methods
}
```

If you implement only `(name, attributes)`, correlation context is silently dropped.

---

## Using Your Adapter

```typescript
import { Events } from 'autotel/events';
import { MyFirstAdapter } from './my-first-adapter';

const events = new Events('my-app', {
  adapters: [new MyFirstAdapter()]
});

// Track events
await events.trackEvent('user.signup', {
  userId: 'user-123',
  email: 'user@example.com'
});

// Cleanup
await events.shutdown();
```

---

## Level Up: Add Real API Calls

Replace the `console.log` with your actual API:

```typescript
export class WebhookAdapter implements EventsAdapter {
  readonly name = 'WebhookAdapter';

  constructor(private webhookUrl: string) {}

  async trackEvent(name: string, attributes?: EventAttributes): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: name, properties: attributes })
    });
  }

  // ... implement other methods similarly
}
```

---

## Production-Ready: Use EventsAdapter

For production deployments, extend `EventsAdapter` to get lifecycle management:

```typescript
import { EventsAdapter, type AdapterPayload } from 'autotel-subscribers';

export class WebhookAdapter extends EventsAdapter {
  readonly name = 'WebhookAdapter';

  constructor(private webhookUrl: string) {
    super();
  }

  protected async sendToDestination(payload: AdapterPayload): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
}
```

**Production features included:** Error handling, pending request tracking, graceful shutdown, enable/disable control.

---

## Test Your Adapter

Use `AdapterTestHarness` to validate it works:

```typescript
import { AdapterTestHarness } from 'autotel-subscribers/testing';

const harness = new AdapterTestHarness(new MyFirstAdapter());
const results = await harness.runAll();

AdapterTestHarness.printResults(results);
// ✅ All tests passed! Your adapter is ready to use.
```

---

## Add Superpowers with Middleware

Compose behaviors without modifying your adapter:

```typescript
import { applyMiddleware, retryMiddleware, loggingMiddleware } from 'autotel-subscribers/middleware';

const adapter = applyMiddleware(
  new MyFirstAdapter(),
  [
    retryMiddleware({ maxRetries: 3 }),  // Retry failed requests
    loggingMiddleware()                   // Log all events
  ]
);
```

Available middleware:
- `retryMiddleware` - Exponential backoff retry
- `samplingMiddleware` - Send only X% of events
- `enrichmentMiddleware` - Add fields to events
- `filterMiddleware` - Only send events matching predicate
- `batchingMiddleware` - Batch events for efficiency
- `rateLimitMiddleware` - Throttle requests
- `circuitBreakerMiddleware` - Prevent cascading failures
- `timeoutMiddleware` - Add timeouts

---

## Next Steps

- [Adapter Guide](./adapter-guide.md) - Level 1-4 progression (Simple → Production)
- [Recipes](./recipes.md) - Common patterns cookbook
- [Examples](../examples/) - Real-world adapter examples

---

## Real-World Example

Here's a complete production-ready adapter:

```typescript
import { EventsAdapter, type AdapterPayload } from 'autotel-subscribers';
import { applyMiddleware, retryMiddleware, circuitBreakerMiddleware } from 'autotel-subscribers/middleware';

class InternalEventsAdapter extends EventsAdapter {
  readonly name = 'InternalEvents';
  readonly version = '1.0.0';

  constructor(private apiKey: string, private endpoint: string) {
    super();
  }

  protected async sendToDestination(payload: AdapterPayload): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        ...payload,
        environment: process.env.NODE_ENV
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }
}

// Add middleware for production
export const createInternalAdapter = (apiKey: string, endpoint: string) => {
  return applyMiddleware(
    new InternalEventsAdapter(apiKey, endpoint),
    [
      retryMiddleware({ maxRetries: 3, delayMs: 1000 }),
      circuitBreakerMiddleware({ failureThreshold: 5, timeout: 60000 })
    ]
  );
};
```

---

**You're done!** You now know how to create, test, and use custom adapters. 🎉
