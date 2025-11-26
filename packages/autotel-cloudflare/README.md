# autotel-cloudflare

**The #1 OpenTelemetry package for Cloudflare Workers** - complete bindings coverage, native CF OTel integration, advanced sampling, zero vendor lock-in.

[![npm version](https://badge.fury.io/js/autotel-cloudflare.svg)](https://www.npmjs.com/package/autotel-cloudflare)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/autotel-cloudflare)](https://bundlephobia.com/package/autotel-cloudflare)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- ✅ **Native Cloudflare OTel integration** - Works with `wrangler.toml` destinations
- ✅ **Complete bindings coverage** - KV, R2, D1, DO, AI, Vectorize, Hyperdrive, and more
- ✅ **Multiple API styles** - `instrument()`, `wrapModule()`, `wrapDurableObject()`, functional
- ✅ **Advanced sampling** - Adaptive tail sampling (10% baseline, 100% errors/slow)
- ✅ **Events integration** - Product analytics with trace correlation
- ✅ **Zero vendor lock-in** - OTLP compatible, works with any backend
- ✅ **Tree-shakeable** - Import only what you need
- ✅ **TypeScript native** - Full type safety

## Installation

```bash
npm install autotel-cloudflare
# or
pnpm add autotel-cloudflare
# or
yarn add autotel-cloudflare
```

## Quick Start

### 1. Configure Cloudflare Native OTel (wrangler.toml)

```toml
[observability.traces]
enabled = true
destinations = ["honeycomb"]  # Configure in CF dashboard
head_sampling_rate = 1.0      # Let autotel handle sampling
```

### 2. Instrument Your Worker

```typescript
import { wrapModule, trace } from 'autotel-cloudflare'

// Zero-boilerplate function tracing
const processOrder = trace(async (orderId: string) => {
  const order = await env.ORDERS_KV.get(orderId)  // Auto-instrumented!
  return order
})

export default wrapModule(
  {
    service: { name: 'my-worker' },
    instrumentBindings: true,    // Auto-instrument KV, R2, D1, etc.
    sampling: 'adaptive'          // 10% baseline, 100% errors/slow
  },
  {
    async fetch(req, env, ctx) {
      return Response.json(await processOrder('123'))
    }
  }
)
```

## API Styles

### Style 1: wrapModule (Recommended)

Inspired by workers-honeycomb-logger:

```typescript
import { wrapModule } from 'autotel-cloudflare'

const handler = {
  async fetch(req, env, ctx) {
    return new Response('Hello')
  }
}

export default wrapModule(
  { service: { name: 'my-worker' } },
  handler
)
```

### Style 2: instrument

```typescript
import { instrument } from 'autotel-cloudflare'

export default instrument(
  {
    async fetch(req, env, ctx) {
      return new Response('Hello')
    }
  },
  { service: { name: 'my-worker' } }
)
```

### Style 3: Functional API (Unique)

Zero-boilerplate function tracing:

```typescript
import { trace, span } from 'autotel-cloudflare'

// Automatic trace name inference
export const createUser = trace(async (data: UserData) => {
  return await db.insert(data)
})

// Factory pattern for context access
export const processPayment = trace(ctx => async (amount: number) => {
  ctx.setAttribute('amount', amount)

  await span('validate.card', () => validateCard())
  await span('charge.card', () => chargeCard(amount))

  return { success: true }
})
```

## Complete Bindings Coverage

### Auto-Instrumented Bindings

All bindings are automatically instrumented when `instrumentBindings: true`:

```typescript
// KV
await env.MY_KV.get('key')           // → Span: "KV MY_KV: get"
await env.MY_KV.put('key', 'value')  // → Span: "KV MY_KV: put"

// R2
await env.MY_R2.get('file.txt')      // → Span: "R2 MY_R2: get"
await env.MY_R2.put('file.txt', data) // → Span: "R2 MY_R2: put"

// D1
await env.MY_D1.prepare('SELECT * FROM users').all()  // → Span: "D1 MY_D1: all"

// Durable Objects
await env.MY_DO.get(id).fetch(req)   // → Span: "DO MY_DO: fetch"

// Workers AI
await env.AI.run('@cf/meta/llama', { prompt: '...' })  // → Span: "AI: run"

// Vectorize
await env.VECTOR.query(vector)       // → Span: "Vectorize VECTOR: query"

// Service Bindings
await env.MY_SERVICE.fetch(req)      // → Span: "Service MY_SERVICE: fetch"

// Queue
await env.MY_QUEUE.send({ data })    // → Span: "Queue MY_QUEUE: send"

// Analytics Engine
await env.ANALYTICS.writeDataPoint({ ... })  // → Span: "Analytics: writeDataPoint"
```

**Supported Bindings:**

- ✅ KV (get, put, delete, list, getWithMetadata)
- ✅ R2 (head, get, put, delete, list, createMultipartUpload)
- ✅ D1 (prepare, batch, exec, dump)
- ✅ Durable Objects (fetch, alarm)
- ✅ Workflows (get, create, getInstance)
- ✅ Workers AI (run)
- ✅ Vectorize (insert, query, getByIds, deleteByIds, upsert)
- ✅ Hyperdrive (all queries)
- ✅ Service Bindings (fetch)
- ✅ Queue (send, sendBatch)
- ✅ Analytics Engine (writeDataPoint)
- ✅ Email (send, forward)

## Sampling Strategies

### Adaptive Sampling (Recommended)

```typescript
import { SamplingPresets } from 'autotel-cloudflare/sampling'

wrapModule(
  {
    service: { name: 'my-worker' },
    sampling: {
      tailSampler: SamplingPresets.production()
      // 10% baseline, 100% errors, 100% slow requests (>1s)
    }
  },
  handler
)
```

### Available Presets

```typescript
// Development - 100% sampling
sampling: { tailSampler: SamplingPresets.development() }

// Production - 10% baseline, all errors, slow >1s
sampling: { tailSampler: SamplingPresets.production() }

// High traffic - 1% baseline, all errors, slow >1s
sampling: { tailSampler: SamplingPresets.highTraffic() }

// Debugging - errors only
sampling: { tailSampler: SamplingPresets.debugging() }

// Or use shorthand
sampling: 'adaptive'      // Same as SamplingPresets.production()
sampling: 'error-only'    // Same as SamplingPresets.debugging()
```

### Custom Sampling

```typescript
import { createCustomTailSampler } from 'autotel-cloudflare/sampling'

const customSampler = createCustomTailSampler((trace) => {
  const span = trace.localRootSpan

  // Always sample /api/* endpoints
  if (span.attributes['http.route']?.toString().startsWith('/api/')) {
    return true
  }

  // Sample all errors
  if (span.status.code === SpanStatusCode.ERROR) {
    return true
  }

  // Sample slow requests
  const duration = (span.endTime[0] - span.startTime[0]) / 1_000_000
  if (duration > 1000) {
    return true
  }

  return Math.random() < 0.1  // 10% of everything else
})
```

## Durable Objects

### Instrument Durable Object Class

```typescript
import { wrapDurableObject } from 'autotel-cloudflare'

class Counter implements DurableObject {
  async fetch(request: Request) {
    // Auto-traced with span "Counter: fetch"
    const count = await this.state.storage.get('count') || 0
    await this.state.storage.put('count', count + 1)
    return new Response(String(count + 1))
  }

  async alarm() {
    // Auto-traced with span "Counter: alarm"
    console.log('Alarm triggered')
  }
}

export default wrapDurableObject(
  { service: { name: 'counter-do' } },
  Counter
)
```

## Events Integration

Track product events with automatic trace correlation:

```typescript
import { publishEvent } from 'autotel-cloudflare/events'

wrapModule(
  {
    service: { name: 'my-worker' },
    // Configure event subscribers
    subscribers: [
      async (event) => {
        // Send to your analytics platform
        await fetch('https://analytics.example.com/events', {
          method: 'POST',
          body: JSON.stringify(event)
        })
      }
    ]
  },
  {
    async fetch(req, env, ctx) {
      // Track user events
      await publishEvent({
        name: 'order.completed',
        userId: '123',
        properties: {
          orderId: 'abc',
          amount: 99.99
        }
        // Automatically includes current trace ID
      })

      return new Response('OK')
    }
  }
)
```

## Configuration

### Complete Example

```typescript
import { wrapModule, SamplingPresets } from 'autotel-cloudflare'

export default wrapModule(
  {
    // Service identification
    service: {
      name: 'my-worker',
      version: '1.0.0',
      namespace: 'production'
    },

    // Auto-instrument bindings
    instrumentBindings: true,

    // Global instrumentations
    instrumentation: {
      instrumentGlobalFetch: true,   // Trace all fetch() calls
      instrumentGlobalCache: true,   // Trace cache API
      disabled: false                // Set true to disable all tracing
    },

    // Sampling strategy
    sampling: {
      tailSampler: SamplingPresets.production()
    },

    // Handler-specific config
    handlers: {
      fetch: {
        postProcess: (span, { request, response }) => {
          // Add custom attributes
          const url = new URL(request.url)
          if (url.pathname.startsWith('/api/')) {
            span.setAttribute('api.endpoint', url.pathname)
          }
        }
      }
    }
  },
  handler
)
```

### Dynamic Configuration

```typescript
// Configuration can be a function
export default wrapModule(
  (env, trigger) => ({
    service: { name: env.SERVICE_NAME || 'my-worker' },
    exporter: {
      url: env.OTEL_ENDPOINT,
      headers: { 'x-api-key': env.API_KEY }
    },
    sampling: {
      tailSampler: env.ENVIRONMENT === 'production'
        ? SamplingPresets.production()
        : SamplingPresets.development()
    }
  }),
  handler
)
```

## Entry Points (Tree-Shaking)

```typescript
// Main export (everything)
import { wrapModule, trace, instrument } from 'autotel-cloudflare'

// Tree-shakeable entry points
import { instrumentKV, instrumentR2 } from 'autotel-cloudflare/bindings'
import { instrumentDO } from 'autotel-cloudflare/handlers'
import { SamplingPresets } from 'autotel-cloudflare/sampling'
import { publishEvent } from 'autotel-cloudflare/events'
import { createEdgeLogger } from 'autotel-cloudflare/logger'
import { createTraceCollector } from 'autotel-cloudflare/testing'
```

## Testing

```typescript
import { createTraceCollector, assertTraceCreated } from 'autotel-cloudflare/testing'

describe('my worker', () => {
  it('creates traces', async () => {
    const collector = createTraceCollector()

    await myFunction()

    assertTraceCreated(collector, 'myFunction')
  })
})
```

## Examples

See [apps/cloudflare-example](../../apps/cloudflare-example) for a complete working example with:

- ✅ All bindings instrumented (KV, R2, D1, etc.)
- ✅ Multiple handler types (fetch, scheduled, queue, email)
- ✅ Durable Objects
- ✅ Custom spans and attributes
- ✅ Error handling
- ✅ Sampling strategies
- ✅ Events tracking

## License

MIT © [Jag Reehal](https://github.com/jagreehal)

## Links

- [GitHub Repository](https://github.com/jagreehal/autotel)
- [Documentation](https://github.com/jagreehal/autotel#readme)
- [Issues](https://github.com/jagreehal/autotel/issues)
- [autotel-edge](../autotel-edge) - Vendor-agnostic foundation
