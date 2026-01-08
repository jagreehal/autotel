# autotel-cloudflare (Cloudflare Workers)

Complete OpenTelemetry solution for Cloudflare Workers. Built on autotel-edge with Cloudflare-specific features.

## Your Role

You are working on the Cloudflare Workers package. You understand Cloudflare Workers runtime, bindings (KV, R2, D1, etc.), and how to instrument them without modifying the SDK.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Base**: autotel-edge (~20KB)
- **Bundle Size**: ~45KB total (autotel-edge 20KB + CF-specific 25KB)
- **Build**: tsup (Cloudflare Workers compatible)
- **Testing**: vitest (with Cloudflare Workers mocks)

## Key Concepts

- **Native CF OTel Integration**: Works with Cloudflare's native observability (wrangler.toml destinations)
- **Complete Bindings Coverage**: Auto-instruments KV, R2, D1, Durable Objects, Workflows, Workers AI, Vectorize, Hyperdrive, Service Bindings, Queue, Analytics Engine, and Email
- **Multiple API Styles**:
  - `instrument(handler, config)` - Compatible with @microlabs/otel-cf-workers
  - `wrapModule(config, handler)` - Compatible with workers-honeycomb-logger
  - `wrapDurableObject(config, DOClass)` - Durable Objects instrumentation
  - Functional API via re-exports from autotel-edge
- **Handler Instrumentation**: Automatic tracing for fetch, scheduled, queue, email handlers
- **Global Instrumentations**: Auto-instrument global fetch() and cache API

## Entry Points

- `autotel-cloudflare` - Everything (wrappers + re-exports from autotel-edge)
- `autotel-cloudflare/bindings` - Just bindings instrumentation
- `autotel-cloudflare/handlers` - Just handler wrappers
- `autotel-cloudflare/sampling` - Re-export from autotel-edge
- `autotel-cloudflare/events` - Re-export from autotel-edge
- `autotel-cloudflare/logger` - Re-export from autotel-edge
- `autotel-cloudflare/testing` - Re-export from autotel-edge

## Commands

```bash
# In packages/autotel-cloudflare directory
pnpm test               # Run tests
pnpm build              # Build package (check bundle size!)
pnpm lint               # Lint package
```

## File Structure

- `src/index.ts` - Main exports (wrappers + re-exports)
- `src/bindings/` - Bindings instrumentation (KV, R2, D1, etc.)
- `src/handlers/` - Handler wrappers (fetch, scheduled, queue, email)
- `src/wrappers/` - API compatibility wrappers
- `src/global/` - Global fetch() and cache API instrumentation

## Code Patterns

### Proxy-Based Instrumentation

Uses Proxy pattern to wrap bindings without modifying them:

```typescript
// KV binding instrumentation
const kv = env.MY_KV; // Original binding
const instrumentedKV = instrumentKV(kv, { name: 'my-kv' });
// Now all kv.get(), kv.put() calls are traced
```

### Handler Wrapping

Multiple API styles for compatibility:

```typescript
// Style 1: instrument() (compatible with @microlabs/otel-cf-workers)
export default instrument(fetchHandler, {
  service: 'my-worker',
  endpoint: 'https://api.honeycomb.io',
});

// Style 2: wrapModule() (compatible with workers-honeycomb-logger)
export default wrapModule({
  service: 'my-worker',
  endpoint: 'https://api.honeycomb.io',
}, fetchHandler);

// Style 3: Functional API (from autotel-edge)
import { trace } from 'autotel-cloudflare';
export default trace(async (request) => {
  return new Response('OK');
});
```

## Boundaries

- ✅ **Always do**: Use Proxy pattern for bindings, maintain API compatibility, check bundle size
- ⚠️ **Ask first**: Adding new bindings, changing API styles, increasing bundle size
- 🚫 **Never do**: Modify Cloudflare SDK, break API compatibility, exceed bundle size limits

## Testing

- Mock Cloudflare Workers runtime (Miniflare)
- Test bindings instrumentation in isolation
- Verify bundle size after builds
- Test all API styles for compatibility

## Why Better than Competitors

- More complete than @microlabs/otel-cf-workers (which lacks R2, AI, Vectorize, Hyperdrive)
- Vendor-agnostic unlike workers-honeycomb-logger (works with any OTLP backend)
- Multiple API styles for maximum flexibility
- Advanced sampling strategies

