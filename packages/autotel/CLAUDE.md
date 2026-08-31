# autotel (Node.js Core)

OpenTelemetry instrumentation with an ergonomic functional API for Node.js runtimes.

## Your Role

You are working on the core Node.js package that provides OpenTelemetry instrumentation. You understand OpenTelemetry SDK, Node.js APIs, and functional programming patterns.

## Tech Stack

- **Runtime**: Node.js 22+
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
- **Event emission guidance**: For new observability events, prefer correlated log-based events over new direct span-event API usage.

## Entry Points

Package uses explicit exports (check `package.json` exports field) for tree-shaking:

- `autotel` - Core trace/span/init functions
- `autotel/logger` - Pino integration
- `autotel/event` - Events API (`Event`, `track`)
- `autotel/metric` - Metrics helpers
- `autotel/analysis` - `compareCohorts()`: ranks the field/value pairs separating an
  outlier group from a baseline. The core analysis loop as a pure function.
- `autotel/slo` - Rolling SLI, error-budget, predictive forecast, and burn-rate calculations
- `autotel/testing` - Test utilities
- `autotel/messaging` - Producer/consumer helpers for Kafka, SQS, RabbitMQ
- `autotel/business-baggage` - Safe baggage propagation with guardrails
- `autotel/workflow` - Workflow and saga tracing
- `autotel/diagnostics` - `diagnostics_channel` bridges: `subscribeChannel` /
  `subscribeTracingChannel` (edge-safe primitive), `captureConsole` (console.\* →
  correlated log records, patch-free), `instrumentHttp` (HTTP server/client
  spans + W3C propagation, opt-in, no `import-in-the-middle`). All degrade to a
  no-op where the underlying Node channels are unavailable.
- `autotel/evidence` - Say what a trace could not see. `recordEvidence()` labels
  one field (`autotel.evidence.cost = 'estimated'`,
  `autotel.evidence.input = 'truncated'`); `captureCoverageAttributes()` declares,
  once per process, which capture surfaces the deployment observes at all
  (`autotel.coverage.observed` / `.unobserved`). Absence of a label means
  unknown — nothing here ever asserts completeness.
- `autotel/feature-flags` - Flag evaluations under the canonical
  `feature_flag.*` convention, plus the `feature_flag.evaluation` event.
  `recordFeatureFlag()` records both: attributes so a single-flag span is
  filterable without unpacking events, and one event per flag because
  attributes hold only one — a second call overwrites the first. Record where
  the code _reads_ a flag, not where it is fetched: a flag evaluated and
  ignored explains nothing. Never invent `feature_flag.<key>`; keyed by flag
  name it cannot be grouped across flags and no backend reads it.
  `autotelOpenFeatureHook()` is the zero-config path — structurally typed
  against the hook shape, so no `@openfeature/*` dependency reaches a bundle.
  The event goes through `track` (correlated log) and **only** `track` — there
  is no `Span.addEvent` fallback, because a fallback is how the Logs API
  direction quietly becomes optional; a caller holding a raw span passes its
  own `track` (in the browser, `emitEvent` from `autotel-web`), and
  `autotelOpenFeatureHook` falls back to an actual `@opentelemetry/api-logs`
  record. **Not** `emitCorrelatedEvent`: that helper prefers `Span.addEvent`
  when the target has one, so routing through it lands the evaluation exactly
  where no log or event pipeline will look — the failure the Logs API invariant
  exists to prevent. `logs.getLogger` no-ops without a `LoggerProvider`, so the
  fallback costs nothing in an app that exports no logs. Reasons are
  case-normalised to the registry's lower snake case: a provider reporting
  `TARGETING_MATCH` and one reporting `targeting_match` must not become two
  buckets. Values stay typed — `feature_flag.result.value` permits a boolean or a
  number, and stringifying one makes it uncomparable with the flag beside it.
  Use `feature_flag.error.message`; the `feature_flag.evaluation.error.message`
  spelling is deprecated.
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

- `src/functional.ts` - Public façade for `trace()`, `span()`, `instrument()`, and context helpers
- `src/functional-wrapper.ts` - Internal functional tracing lifecycle (option types, naming, sampling, metrics, finalization, flushing, and active context)
- `src/init.ts` - OpenTelemetry SDK initialization
- `src/config.ts` - Runtime configuration
- `src/attributes/` - Type-safe attribute builders
- `src/node-require.ts` - Dynamic module loading helpers (CJS/ESM)
- `src/tail-sampling-processor.ts` - Deferred sampling decisions
- `src/events-queue.ts` - Async event queue

## Code Patterns

### Functional API Pattern

`trace(fn)` deterministically wraps a plain function with an inferred name. Use
the ambient accessor when that reusable function needs context:

```typescript
export const createUser = trace(async (data) => {
  getActiveTraceContext()?.setAttribute('user.id', data.id);
  return await db.users.create(data);
});
```

`trace.run(name, operation)` immediately runs a named operation with an
explicit context and returns its result:

```typescript
const user = await trace.run('user.create', async (ctx) => {
  ctx.setAttribute('user.id', input.id);
  return db.users.create(input);
});
```

`trace(name, fn)` wraps a reusable function under an explicit stable name, and
`trace(name)` curries the same thing when one configuration is applied to many
functions:

```typescript
export const createUser = trace('user.create', async (data) => {
  return db.users.create(data);
});
```

`instrument({ key, fn })` is the options form of that same wrapper.

**`trace` wraps, `trace.run` runs.** Keep them separate names. Dispatch must
never depend on callback parameter names or minification-sensitive source
inspection, and no `trace(...)` overload may execute user code.

Use `withTracing()` for an explicit factory:

```typescript
export const createUser = withTracing({ name: 'user.create' })(
  (ctx) => async (data) => {
    ctx.setAttribute('user.id', data.id);
    return await db.users.create(data);
  },
);
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
