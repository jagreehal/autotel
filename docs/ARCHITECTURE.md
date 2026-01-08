# Architecture & Code Patterns

Code structure patterns, conventions, and important architectural decisions.

## Functional API Pattern

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

The implementation auto-detects the pattern by analyzing the function signature and checking the first parameter name against known hints (`ctx`, `context`, `tracecontext`, etc.).

### Trace Name Inference

Trace names are inferred automatically with the following priority:

1. **Explicit name** (from `trace('customName', ...)` or `instrument()` key)
2. **Named function expressions** (e.g., `trace((ctx) => async function createUser() {})`)
3. **Variable name from assignment** (e.g., `const processDocuments = trace(...)` → "processDocuments")
4. **Factory function name** (if the outer function is named)

The variable name inference (priority #3) works by analyzing the call stack to find the source line where `trace()` is called, then parsing it to extract the variable name from const/let/var assignments. This is especially useful for arrow functions in the factory pattern:

```typescript
// Arrow function with inferred name from const assignment
export const processDocuments = trace((ctx) => async (data: string) => {
  ctx.setAttribute('document.count', data.length)
  return data.toUpperCase()
})
// Trace name: "processDocuments" (inferred from const)

// Named function expression (takes precedence)
export const processDocuments = trace((ctx) => async function processData(data: string) => {
  return data.toUpperCase()
})
// Trace name: "processData" (from named function, not "processDocuments")
```

**Limitations:**

- Minified/obfuscated code may prevent name inference
- Edge runtimes without file system access will fall back to unnamed spans
- Results are cached per source location for performance

## Events Queue Pattern

Events use an async queue to prevent blocking the main execution path:

- Events are queued immediately and returned
- Background worker processes queue and sends to all configured adapters
- Adapters can implement batching/buffering independently
- Shutdown waits for queue to drain

## Configuration Layering

Two separate config systems serve different purposes:

1. **Init Config** (`init.ts`): Global OpenTelemetry SDK setup (resource, exporters, instrumentations)
2. **Runtime Config** (`config.ts`): Per-operation configuration (sampling rates, rate limits, circuit breaker thresholds)

## Tail Sampling Processor

Implements deferred sampling decisions:

- Spans are buffered in-memory during execution
- Sampling decision made after span ends (can inspect attributes, status, duration)
- Default `AdaptiveSampler`: 10% baseline, 100% errors, 100% slow requests
- Custom samplers can implement `Sampler` interface

## Type-Safe Attributes

The `autotel/attributes` module provides type-safe OpenTelemetry attribute builders following semantic conventions:

**Module Structure:**

- `builders.ts` - Key builders (`attrs.user.id()`) and object builders (`attrs.user.data()`)
- `attachers.ts` - Signal helpers that know WHERE to attach attributes (`setUser()`, `httpServer()`, etc.)
- `domains.ts` - Domain-specific helpers (`transaction()`) that bundle multiple attribute groups
- `validators.ts` - PII detection, guardrails, and deprecated attribute warnings
- `utils.ts` - `safeSetAttributes()` and `mergeAttrs()` utilities
- `types.ts` - TypeScript types for all attribute domains
- `registry.ts` - Semantic convention constants

**Key APIs:**

```typescript
import {
  attrs,
  setUser,
  safeSetAttributes,
  transaction,
} from 'autotel/attributes';

// Key builders - single attributes
ctx.setAttributes(attrs.user.id('user-123'));
ctx.setAttributes(attrs.http.request.method('GET'));

// Object builders - multiple related attributes
ctx.setAttributes(attrs.user.data({ id: '123', email: 'user@example.com' }));

// Attachers - know WHERE to attach + apply guardrails
setUser(ctx, { id: '123', email: 'user@example.com' }); // Auto-redacts PII
httpServer(ctx, { method: 'GET', route: '/api/users', statusCode: 200 });

// Safe attributes with guardrails
safeSetAttributes(ctx, attrs.user.data({ email: 'pii@example.com' }), {
  guardrails: { pii: 'hash' }, // Options: 'allow', 'redact', 'hash', 'block'
});

// Domain helpers - bundle attributes for common scenarios
transaction(ctx, { user: { id: '123' }, method: 'POST', route: '/api/orders' });
```

**Guardrails Options:**

- `pii: 'allow' | 'redact' | 'hash' | 'block'` - How to handle PII (default: 'redact')
- `maxLength: number` - Truncate long values (default: 255)
- `warnDeprecated: boolean` - Log warnings for deprecated attributes (default: true)

**Resource Merging:**

```typescript
import { mergeServiceResource } from 'autotel/attributes';

// Resource.attributes is readonly - use merge to add service attributes
const enrichedResource = mergeServiceResource(resource, {
  name: 'my-service',
  version: '1.0.0',
});
```

## Important Patterns & Conventions

### Tree-Shaking & Bundle Size

All packages are configured for aggressive tree-shaking:

- Use `"sideEffects": false` in package.json
- Export all public APIs explicitly in package.json `exports` field
- Keep dependencies minimal (especially in autotel-edge)
- External dependencies (pino, winston) are marked as peer/optional

### TypeScript Decorators

The codebase uses TypeScript 5.0+ decorators (not experimental legacy decorators). Test execution uses `tsx` which supports the new decorator syntax. The `decorators.ts` module provides `@Trace` decorator for class methods.

### OpenTelemetry Context Propagation

The library uses standard OpenTelemetry context propagation:

- Active context is stored in AsyncLocalStorage (Node.js) or async context (edge)
- `trace()` automatically creates child spans in the active context
- Use `withNewContext()` to create isolated trace trees
- Context includes custom attributes via `runInOperationContext()`

### Dynamic Module Loading (CJS/ESM Compatibility)

**Never use `await import()` for dynamic module loading.** Instead, use the `node-require` helper functions from `./node-require`:

```typescript
// ❌ DON'T: Using async import()
const mod = await import('some-module');

// ✅ DO: Use node-require helpers
import { safeRequire, requireModule } from './node-require';

// For optional dependencies (returns undefined if missing)
const traceloop = safeRequire('@traceloop/node-server-sdk');
if (traceloop) {
  traceloop.initialize({ ... });
}

// For required dependencies (throws if missing)
const fs = requireModule<typeof import('node:fs')>('node:fs');
const content = fs.readFileSync('file.txt', 'utf8');
```

**Why?**

- `init()` and other core functions must remain **synchronous**
- `await import()` makes functions async, breaking the API contract
- The `node-require` helper uses `createRequire()` pattern for ESM compatibility
- Works in both CJS and ESM builds (tsup handles the differences)
- Consistent, synchronous module loading across the codebase

**Implementation:** See `packages/autotel/src/node-require.ts` for details.

### Graceful Shutdown

All components implement graceful shutdown:

- `shutdown()` function flushes pending spans/metrics/logs
- Events queue drains before shutdown completes
- Adapters track pending requests and wait for completion
- Use `flush()` for intermediate flushing without shutdown

## Known Constraints

### Edge Runtime Limitations

- No Node.js APIs (fs, net, process) in autotel-edge
- Bundle size must stay under 1MB for Cloudflare Workers free tier
- Some OpenTelemetry features unavailable (auto-instrumentations, resource detectors)
- Context propagation uses minimal AsyncLocalStorage polyfill

### Auto-Instrumentation Requirements

**ESM Setup (Node 18.19+) - Recommended:**

For ESM apps using auto-instrumentation (Pino, Express, HTTP, etc.), you need to:

1. Install `@opentelemetry/auto-instrumentations-node` as a **direct dependency** in your app
2. Import `autotel/register` **first** to register the ESM loader hooks
3. Pass instrumentations directly to `init()` using `getNodeAutoInstrumentations()`

**Option A: With instrumentation.mjs (explicit init, full control):**

```typescript
// instrumentation.mjs
import 'autotel/register'; // MUST be first import!
import { init } from 'autotel';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

init({
  service: 'my-app',
  instrumentations: getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-pino': { enabled: true },
    '@opentelemetry/instrumentation-http': { enabled: true },
  }),
});
```

```bash
tsx --import ./instrumentation.mjs src/index.ts
```

**Option B: Zero-config (reads from env vars):**

```bash
OTEL_SERVICE_NAME=my-app tsx --import autotel/auto src/index.ts
```

Env vars: `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `AUTOTEL_AUTO_INSTRUMENTATIONS` (comma-separated or 'true'), `AUTOTEL_DEBUG`

**Legacy (Node 18.0-18.18):**

```bash
NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./instrumentation.mjs" tsx src/index.ts
```

**CommonJS:**
No loader hooks required, just use `--require ./instrumentation.js`

**Why ESM requires direct dependency:**
OpenTelemetry's ESM instrumentation uses `import-in-the-middle` to hook into module loading. For this to work, the auto-instrumentations package must be resolvable from your app's node_modules, not just from autotel's dependencies.

### Peer Dependencies

- `@opentelemetry/auto-instrumentations-node` - **optional** peer dependency (install in your app for ESM instrumentation)
- Logger integrations (pino, winston) are optional peer dependencies
- OpenLLMetry integration (@traceloop/node-server-sdk) is optional peer dependency
- gRPC exporters are optional peer dependencies
- Missing optional peer dependencies gracefully degrade with helpful error messages

### Build Outputs

- ESM-first with CJS fallback for index.ts only
- Type definitions (.d.ts) generated from ESM build
- Source maps enabled for debugging
- Use `tsup` for bundling (not tsc directly)

