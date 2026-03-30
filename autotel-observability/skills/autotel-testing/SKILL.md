---
name: autotel-testing
description: >
  Test autotel instrumentation with createTraceCollector() and InMemorySpanExporter. Assert spans were created,
  attributes were set, errors were recorded. Use when writing tests for instrumented code.
---

# Autotel Testing

Test your autotel instrumentation to verify spans, attributes, errors, and events are emitted correctly.

## Purpose

Guide for writing tests that verify autotel instrumentation. Covers test utilities, assertion patterns, and complete examples.

## When to Use

- Writing tests for instrumented functions
- Verifying span names and attributes
- Testing structured error recording
- Testing request logger output
- Testing product events via track()

## Test Utilities

### createTraceCollector() (recommended)

High-level test utility that collects completed spans for assertion.

```typescript
import { createTraceCollector } from 'autotel/testing';
```

**API:**
- `collector.getSpans()` — returns all completed spans
- `collector.getSpanByName(name)` — find a span by name
- `collector.getSpansByName(name)` — find all spans with a name
- `collector.reset()` — clear collected spans
- `collector.shutdown()` — clean up resources

### InMemorySpanExporter (low-level)

For custom test setups when you need direct access to the exporter.

```typescript
import { InMemorySpanExporter } from 'autotel/exporters';
```

## Test Setup

### With createTraceCollector (vitest)

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTraceCollector } from 'autotel/testing';

const collector = createTraceCollector();

beforeEach(() => {
  collector.reset();
});

afterAll(async () => {
  await collector.shutdown();
});
```

### File Naming Convention

- **Unit tests:** `*.test.ts` — test individual instrumented functions
- **Integration tests:** `*.integration.test.ts` — test full request flows with OTel SDK

Unit tests and integration tests use separate vitest configs in the autotel monorepo.

## Assertion Patterns

### Assert a Span Was Created

```typescript
import { trace } from 'autotel';
import { createTraceCollector } from 'autotel/testing';

const collector = createTraceCollector();

const getUser = trace(async (id: string) => {
  return { id, name: 'Alice' };
});

it('creates a span for getUser', async () => {
  collector.reset();
  await getUser('123');

  const spans = collector.getSpans();
  expect(spans).toHaveLength(1);
  expect(spans[0].name).toBe('getUser');
});
```

### Assert Span Attributes

```typescript
const processOrder = trace((ctx) => async (orderId: string, total: number) => {
  ctx.setAttribute('order.id', orderId);
  ctx.setAttribute('order.total', total);
  return { success: true };
});

it('records order attributes on the span', async () => {
  collector.reset();
  await processOrder('order-1', 99.99);

  const span = collector.getSpanByName('processOrder');
  expect(span).toBeDefined();
  expect(span!.attributes['order.id']).toBe('order-1');
  expect(span!.attributes['order.total']).toBe(99.99);
});
```

### Assert Error Recording

```typescript
import { createStructuredError } from 'autotel';

const riskyOperation = trace(async () => {
  throw createStructuredError({
    message: 'Something broke',
    status: 500,
    why: 'Database connection lost',
  });
});

it('records the error on the span', async () => {
  collector.reset();

  await expect(riskyOperation()).rejects.toThrow('Something broke');

  const span = collector.getSpanByName('riskyOperation');
  expect(span).toBeDefined();
  expect(span!.status.code).toBe(2); // SpanStatusCode.ERROR
  expect(span!.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'exception' }),
    ])
  );
});
```

### Assert Request Logger Output

```typescript
import { trace, getRequestLogger } from 'autotel';

const handleRequest = trace((ctx) => async (userId: string) => {
  const log = getRequestLogger(ctx);
  log.set({ user: { id: userId } });
  log.info('Request processed');
  log.emitNow();
  return { ok: true };
});

it('emits request logger snapshot', async () => {
  collector.reset();
  await handleRequest('user-1');

  const span = collector.getSpanByName('handleRequest');
  expect(span).toBeDefined();

  // Request logger emits as span events
  const events = span!.events;
  expect(events.length).toBeGreaterThan(0);

  // Check that the snapshot event contains our attributes
  const snapshot = events.find((e) => e.name === 'request.snapshot' || e.name === 'log');
  expect(snapshot).toBeDefined();
});
```

### Assert Product Events (track)

```typescript
import { track, getEventQueue } from 'autotel';

it('tracks a product event', async () => {
  const mockSubscriber = {
    events: [] as any[],
    trackEvent(name: string, attributes: any) {
      this.events.push({ name, attributes });
    },
  };

  // Register mock subscriber (setup depends on your test config)

  track('order.completed', { orderId: 'order-1', amount: 99.99 });

  // Flush the event queue before assertions
  await getEventQueue()?.flush();

  expect(mockSubscriber.events).toContainEqual(
    expect.objectContaining({
      name: 'order.completed',
      attributes: expect.objectContaining({ orderId: 'order-1' }),
    })
  );
});
```

### Assert Nested Spans (Parent-Child)

```typescript
const parentOp = trace(async () => {
  return await childOp();
});

const childOp = trace(async () => {
  return { done: true };
});

it('creates parent-child span relationship', async () => {
  collector.reset();
  await parentOp();

  const spans = collector.getSpans();
  expect(spans).toHaveLength(2);

  const parent = collector.getSpanByName('parentOp');
  const child = collector.getSpanByName('childOp');

  expect(parent).toBeDefined();
  expect(child).toBeDefined();
  expect(child!.parentSpanId).toBe(parent!.spanContext().spanId);
});
```

## Complete Example Test File

```typescript
// src/routes/checkout.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTraceCollector } from 'autotel/testing';
import { trace, getRequestLogger, createStructuredError } from 'autotel';

// --- System under test ---

const processCheckout = trace((ctx) => async (userId: string, items: string[]) => {
  const log = getRequestLogger(ctx);
  log.set({ user: { id: userId }, cart: { items: items.length } });

  if (items.length === 0) {
    throw createStructuredError({
      message: 'Cart is empty',
      status: 422,
      why: 'Cannot checkout with an empty cart',
      fix: 'Add items to your cart first',
    });
  }

  const orderId = `order-${Date.now()}`;
  log.set({ order: { id: orderId } });
  log.emitNow();
  return { orderId };
});

// --- Tests ---

const collector = createTraceCollector();

beforeEach(() => {
  collector.reset();
});

afterAll(async () => {
  await collector.shutdown();
});

describe('processCheckout', () => {
  it('creates a span with correct name', async () => {
    await processCheckout('user-1', ['item-1']);

    const span = collector.getSpanByName('processCheckout');
    expect(span).toBeDefined();
  });

  it('records user and cart attributes', async () => {
    await processCheckout('user-1', ['item-1', 'item-2']);

    const span = collector.getSpanByName('processCheckout');
    expect(span!.events.length).toBeGreaterThan(0);
  });

  it('records structured error for empty cart', async () => {
    await expect(processCheckout('user-1', [])).rejects.toThrow('Cart is empty');

    const span = collector.getSpanByName('processCheckout');
    expect(span!.status.code).toBe(2); // ERROR
    expect(span!.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'exception' }),
      ])
    );
  });

  it('returns order ID on success', async () => {
    const result = await processCheckout('user-1', ['item-1']);
    expect(result.orderId).toMatch(/^order-/);
  });
});
```

## Tips

- **Always call `collector.reset()` in `beforeEach`** to isolate tests
- **Call `collector.shutdown()` in `afterAll`** to clean up resources
- **Flush event queues before assertions** when testing `track()` calls
- **Check span.events for request logger output** — `.emitNow()` creates span events
- **Check span.status.code** for error assertions: `0` = UNSET, `1` = OK, `2` = ERROR
- **Use `getSpanByName()`** for targeted assertions instead of indexing into `getSpans()`
