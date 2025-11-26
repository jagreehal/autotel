# autotel-edge

**Vendor-agnostic OpenTelemetry for edge runtimes** - the foundation for Cloudflare Workers, Vercel Edge, Netlify Edge, Deno Deploy, and more.

[![npm version](https://badge.fury.io/js/autotel-edge.svg)](https://www.npmjs.com/package/autotel-edge)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/autotel-edge)](https://bundlephobia.com/package/autotel-edge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

`autotel-edge` is a lightweight (~20KB), vendor-agnostic OpenTelemetry implementation designed specifically for edge runtimes. It provides the core functionality for tracing, sampling, events, and logging without any vendor-specific dependencies.

### For Cloudflare Workers Users

If you're using Cloudflare Workers, use **[autotel-cloudflare](../autotel-cloudflare)** instead, which includes complete Cloudflare bindings instrumentation (KV, R2, D1, etc.) and handler wrappers.

### When to Use autotel-edge Directly

Use this package directly if you're:
- Building for Vercel Edge Functions
- Building for Netlify Edge Functions
- Building for Deno Deploy
- Building a custom edge runtime
- Creating a vendor-specific package (like `autotel-vercel`)

## Features

- ✅ **Zero-boilerplate functional API** - `trace()`, `span()`, `instrument()`
- ✅ **Advanced sampling strategies** - Adaptive, error-only, slow-only, custom
- ✅ **Events integration** - Product analytics with trace correlation
- ✅ **Zero-dependency logger** - Trace-aware logging
- ✅ **Tree-shakeable** - Import only what you need
- ✅ **Bundle size optimized** - ~20KB minified (~8KB gzipped)
- ✅ **OpenTelemetry compliant** - Works with any OTLP backend
- ✅ **TypeScript native** - Full type safety

## Installation

```bash
npm install autotel-edge
# or
pnpm add autotel-edge
# or
yarn add autotel-edge
```

## Quick Start

### Basic Usage

```typescript
import { trace, init } from 'autotel-edge'

// Initialize once at startup
init({
  service: { name: 'my-edge-function' },
  exporter: {
    url: process.env.OTEL_ENDPOINT || 'http://localhost:4318/v1/traces'
  }
})

// Zero-boilerplate function tracing
export const handler = trace(async (request: Request) => {
  return new Response('Hello World')
})
```

### Factory Pattern (for context access)

```typescript
import { trace } from 'autotel-edge'

// Factory pattern - receives context, returns handler
export const processOrder = trace(ctx => async (orderId: string) => {
  ctx.setAttribute('order.id', orderId)

  // Your business logic
  const order = await getOrder(orderId)

  return order
})
```

## Entry Points (Tree-Shaking)

The package provides multiple entry points for optimal tree-shaking:

```typescript
// Core API
import { trace, span, init } from 'autotel-edge'

// Sampling strategies
import { createAdaptiveSampler, SamplingPresets } from 'autotel-edge/sampling'

// Events system
import { createEdgeSubscribers, publishEvent } from 'autotel-edge/events'

// Logger
import { createEdgeLogger } from 'autotel-edge/logger'

// Testing utilities
import { createTraceCollector, assertTraceCreated } from 'autotel-edge/testing'
```

## Sampling Strategies

### Adaptive Sampling (Recommended for Production)

```typescript
import { SamplingPresets } from 'autotel-edge/sampling'

init({
  service: { name: 'my-app' },
  exporter: { url: '...' },
  sampling: {
    tailSampler: SamplingPresets.production()
    // 10% baseline, 100% errors, 100% slow requests (>1s)
  }
})
```

### Available Presets

```typescript
import { SamplingPresets } from 'autotel-edge/sampling'

// Development - 100% sampling
SamplingPresets.development()

// Production - 10% baseline, all errors, slow >1s
SamplingPresets.production()

// High traffic - 1% baseline, all errors, slow >1s
SamplingPresets.highTraffic()

// Debugging - errors only
SamplingPresets.debugging()
```

### Custom Sampling

```typescript
import { createCustomTailSampler } from 'autotel-edge/sampling'

const customSampler = createCustomTailSampler((trace) => {
  const span = trace.localRootSpan

  // Sample all /api/* requests
  if (span.attributes['http.route']?.toString().startsWith('/api/')) {
    return true
  }

  // Sample errors
  if (span.status.code === SpanStatusCode.ERROR) {
    return true
  }

  // Drop everything else
  return false
})
```

## Events Integration

Track product events with automatic trace correlation:

```typescript
import { publishEvent } from 'autotel-edge/events'

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
```

## Logger

Zero-dependency logger with trace context:

```typescript
import { createEdgeLogger } from 'autotel-edge/logger'

const log = createEdgeLogger('my-service')

log.info('Processing request', { userId: '123' })
log.error('Request failed', { error })
// Automatically includes trace ID, span ID
```

## Testing

```typescript
import { createTraceCollector, assertTraceCreated } from 'autotel-edge/testing'

// In your tests
const collector = createTraceCollector()

await myFunction()

assertTraceCreated(collector, 'myFunction')
```

## Supported Runtimes

- ✅ Cloudflare Workers (use [autotel-cloudflare](../autotel-cloudflare))
- ✅ Vercel Edge Functions
- ✅ Netlify Edge Functions
- ✅ Deno Deploy
- ✅ AWS Lambda@Edge (with caveats)
- ✅ Any edge runtime with `fetch()` and `AsyncLocalStorage` support

## Configuration

### Service Configuration

```typescript
init({
  service: {
    name: 'my-edge-function',
    version: '1.0.0',
    namespace: 'production'
  }
})
```

### Exporter Configuration

```typescript
init({
  exporter: {
    url: 'https://api.honeycomb.io/v1/traces',
    headers: {
      'x-honeycomb-team': process.env.HONEYCOMB_API_KEY
    }
  }
})
```

### Dynamic Configuration

```typescript
// Configuration can be a function
init((env) => ({
  service: { name: env.SERVICE_NAME },
  exporter: { url: env.OTEL_ENDPOINT }
}))
```

## API Reference

### Core Functions

#### `trace(fn)` / `trace(options, fn)`

Zero-boilerplate function tracing with automatic span management.

```typescript
// Simple function
const handler = trace(async (request: Request) => {
  return new Response('OK')
})

// With options
const handler = trace({
  name: 'custom-name',
  attributesFromArgs: ([request]) => ({
    'http.method': request.method
  })
}, async (request: Request) => {
  return new Response('OK')
})

// Factory pattern (for context access)
const handler = trace(ctx => async (request: Request) => {
  ctx.setAttribute('custom', 'value')
  return new Response('OK')
})
```

#### `span(options, fn)`

Create a named span for a code block.

```typescript
const result = await span(
  { name: 'database.query', attributes: { table: 'users' } },
  async (span) => {
    const data = await db.query('SELECT * FROM users')
    span.setAttribute('rows', data.length)
    return data
  }
)
```

#### `init(config)`

Initialize the OpenTelemetry SDK.

```typescript
init({
  service: { name: 'my-app' },
  exporter: { url: '...' },
  sampling: { tailSampler: SamplingPresets.production() }
})
```

## Bundle Size

- **Core:** ~20KB minified (~8KB gzipped)
- **With all entry points:** ~25KB minified (~10KB gzipped)
- **Tree-shakeable:** Import only what you need

## Vendor Packages

- **[autotel-cloudflare](../autotel-cloudflare)** - Cloudflare Workers (with KV, R2, D1, etc.)
- **autotel-vercel** - Coming soon
- **autotel-netlify** - Coming soon

## License

MIT © [Jag Reehal](https://github.com/jagreehal)

## Links

- [GitHub Repository](https://github.com/jagreehal/autotel)
- [Documentation](https://github.com/jagreehal/autotel#readme)
- [Issues](https://github.com/jagreehal/autotel/issues)
