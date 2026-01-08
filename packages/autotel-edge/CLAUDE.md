# autotel-edge (Edge Runtime Foundation)

Vendor-agnostic OpenTelemetry foundation for edge runtimes. Bundle size optimized (~20KB vs 700KB for Node.js version).

## Your Role

You are working on the edge runtime foundation package. You understand edge runtime constraints (no Node.js APIs), bundle size optimization, and OpenTelemetry in resource-constrained environments.

## Tech Stack

- **Runtimes**: Cloudflare Workers, Vercel Edge, Netlify Edge, Deno Deploy, or any edge runtime with fetch() and AsyncLocalStorage
- **Language**: TypeScript 5.0+ (ESM-only)
- **Build**: tsup (bundle size optimized)
- **Testing**: vitest
- **Key Constraint**: Bundle size must stay under 1MB for Cloudflare Workers free tier

## Key Concepts

- **Core Functionality**: TracerProvider, OTLP exporter, context management
- **Functional API**: Same `trace()`, `span()`, `instrument()` API as Node.js version
- **Sampling Strategies**: Adaptive, error-only, slow-only, custom samplers
- **Events System**: Product analytics with trace correlation
- **Zero-Dependency Logger**: Trace-aware logging
- **Testing Utilities**: Test harnesses and assertion helpers

## Entry Points

- `autotel-edge` - Core functional API
- `autotel-edge/sampling` - Sampling strategies
- `autotel-edge/events` - Events system
- `autotel-edge/logger` - Logger
- `autotel-edge/testing` - Testing utilities

## Commands

```bash
# In packages/autotel-edge directory
pnpm test               # Run tests
pnpm build              # Build package (check bundle size!)
pnpm lint               # Lint package
```

## File Structure

- `src/index.ts` - Core functional API (re-exports)
- `src/tracer-provider.ts` - Edge-compatible TracerProvider
- `src/context.ts` - AsyncLocalStorage polyfill for edge
- `src/sampling/` - Sampling strategies
- `src/events.ts` - Events system
- `src/logger.ts` - Zero-dependency logger

## Constraints

- **No Node.js APIs**: No fs, net, process, etc.
- **Bundle Size**: Must stay under 1MB (target: ~20KB)
- **No Auto-Instrumentations**: Edge runtimes don't support auto-instrumentations
- **Minimal Dependencies**: Keep dependencies minimal for bundle size

## Code Patterns

### Edge-Compatible Context

Uses minimal AsyncLocalStorage polyfill:

```typescript
// Works in both Node.js and edge runtimes
import { trace } from 'autotel-edge';

export const handler = trace(async (request) => {
  // Automatic span creation
  return new Response('OK');
});
```

### Bundle Size Optimization

- Tree-shakeable exports
- Minimal dependencies
- No heavy Node.js SDK dependencies
- Use Web APIs (fetch, crypto.subtle) instead of Node.js APIs

## Boundaries

- ✅ **Always do**: Use Web APIs, optimize for bundle size, test in edge runtimes
- ⚠️ **Ask first**: Adding dependencies, increasing bundle size significantly
- 🚫 **Never do**: Use Node.js APIs, add heavy dependencies, break bundle size limits

## Testing

- Tests run in Node.js but must be compatible with edge runtimes
- Mock edge runtime APIs (fetch, AsyncLocalStorage)
- Verify bundle size after builds

