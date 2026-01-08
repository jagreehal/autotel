# autotel (Node.js Core)

OpenTelemetry instrumentation with an ergonomic functional API for Node.js runtimes.

## Your Role

You are working on the core Node.js package that provides OpenTelemetry instrumentation. You understand OpenTelemetry SDK, Node.js APIs, and functional programming patterns.

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsup
- **Testing**: vitest (unit + integration)
- **Key Dependencies**: `@opentelemetry/sdk-trace-node`, `@opentelemetry/api`

## Key Concepts

- **Functional API**: Primary interface using `trace()`, `span()`, and `instrument()` functions that wrap business logic with automatic span lifecycle management
- **Dual Configuration System**:
  - `init()` sets up global OpenTelemetry SDK (service name, exporters, resource detection)
  - `getConfig()` provides runtime configuration for sampling, rate limiting, circuit breakers
- **Production Hardening**: Built-in rate limiters, circuit breakers, and PII redaction
- **Adaptive Sampling**: Defaults to 10% baseline sampling, 100% for errors/slow operations (tail sampling)
- **Events Integration**: Unified API to send product events to any platform via adapters

## Entry Points

Package uses explicit exports (check `package.json` exports field) for tree-shaking:

- `autotel` - Core trace/span/init functions
- `autotel/logger` - Pino integration
- `autotel/events` - Events API
- `autotel/metrics` - Metrics helpers
- `autotel/testing` - Test utilities
- `autotel/messaging` - Producer/consumer helpers for Kafka, SQS, RabbitMQ
- `autotel/business-baggage` - Safe baggage propagation with guardrails
- `autotel/workflow` - Workflow and saga tracing
- And more (see package.json exports)

## Commands

```bash
# In packages/autotel directory
pnpm test               # Unit tests only
pnpm test:integration   # Integration tests
pnpm build              # Build package
pnpm lint               # Lint package
```

## File Structure

- `src/functional.ts` - Core `trace()`, `span()`, `instrument()` functions
- `src/init.ts` - OpenTelemetry SDK initialization
- `src/config.ts` - Runtime configuration
- `src/attributes/` - Type-safe attribute builders
- `src/node-require.ts` - Dynamic module loading helpers (CJS/ESM)
- `src/tail-sampling-processor.ts` - Deferred sampling decisions
- `src/events-queue.ts` - Async event queue

## Code Patterns

### Functional API Pattern

The core `trace()` function uses a factory pattern to detect if the user is passing a function that needs a context parameter:

```typescript
// Factory pattern (receives ctx)
export const createUser = trace((ctx) => async (data) => {
  ctx.setAttribute('user.id', data.id);
  return await db.users.create(data);
});

// Direct pattern (no ctx needed)
export const getUser = trace(async (id) => {
  return await db.users.findById(id);
});
```

### Dynamic Module Loading

**Never use `await import()`**. Use `node-require` helpers:

```typescript
import { safeRequire, requireModule } from './node-require';

// Optional dependency
const traceloop = safeRequire('@traceloop/node-server-sdk');
if (traceloop) {
  traceloop.initialize({ ... });
}

// Required dependency
const fs = requireModule<typeof import('node:fs')>('node:fs');
```

## Boundaries

- ✅ **Always do**: Use `node-require` for dynamic imports, keep `init()` synchronous, maintain tree-shaking
- ⚠️ **Ask first**: Adding new dependencies, modifying SDK initialization, changing core API
- 🚫 **Never do**: Use `await import()`, break tree-shaking, modify global OTel context without isolation

## Testing

- Unit tests: `*.test.ts` (excluded from integration config)
- Integration tests: `*.integration.test.ts` (require OTel SDK setup)
- Use `createTraceCollector()` from `autotel/testing` for high-level testing
- Use `InMemorySpanExporter` from `autotel/exporters` for low-level testing

See `docs/DEVELOPMENT.md` for detailed testing patterns.
