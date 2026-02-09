# autotel-sentry (Sentry Bridge)

Bridge OpenTelemetry (Autotel) traces to Sentry for performance monitoring and error linking.

## Your Role

You are working on the Sentry integration package. You understand OpenTelemetry span processors, W3C trace propagation, Sentry's OpenTelemetry integration spec, and how to bridge OTel spans to Sentry transactions/spans.

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsup
- **Testing**: vitest
- **Key Dependencies**:
  - `@opentelemetry/api` - OTel context and trace API
  - `@opentelemetry/sdk-trace-base` - SpanProcessor interface
  - `@opentelemetry/semantic-conventions` - Standard attribute names
  - `@sentry/node` - Peer dependency (user-installed)

## Key Concepts

- **SpanProcessor Pattern**: `SentrySpanProcessor` implements OpenTelemetry's `SpanProcessor` interface to convert OTel spans to Sentry transactions/spans
- **Minimal Interface Coupling**: Uses `SentryLike` interface (only 3 methods) for compatibility across Sentry SDK versions
- **Span Lifecycle Mapping**:
  - Root OTel spans → Sentry transactions
  - Child OTel spans → Sentry child spans
  - OTel exception events → Sentry errors
- **Propagation**: `SentryPropagator` handles `sentry-trace` and `baggage` headers for distributed tracing and dynamic sampling
- **Infinite Loop Prevention**: Filters out spans for requests to Sentry ingestion endpoint

## Entry Points

Single entry point with tree-shakeable exports:

- `autotel-sentry` - Main export: `createSentrySpanProcessor`, `SentrySpanProcessor`, `SentryPropagator`

## Commands

```bash
# In packages/autotel-sentry directory
pnpm test               # Run tests
pnpm build              # Build package
pnpm lint               # Lint package
pnpm type-check         # TypeScript type checking
```

## File Structure

- `src/index.ts` - Public exports
- `src/processor.ts` - `SentrySpanProcessor` implementation (converts OTel → Sentry)
- `src/propagator.ts` - `SentryPropagator` implementation (sentry-trace/baggage headers)
- `src/helpers.ts` - Mapping utilities (status, op/description, trace data extraction)
- `src/*.test.ts` - Unit tests (26 tests)

## Code Patterns

### Processor Pattern

The core processor maps OTel spans to Sentry spans:

```typescript
export class SentrySpanProcessor implements SpanProcessor {
  private readonly map = new Map<string, SentrySpanLike | SentryTransactionLike>();

  onStart(span: Span, _parentContext: Context): void {
    // Create Sentry transaction (root) or child span
    const parentSentry = this.map.get(parentSpanId);
    if (parentSentry) {
      const child = parentSentry.startChild({ ... });
      this.map.set(spanId, child);
    } else {
      const transaction = hub.startTransaction({ ... });
      this.map.set(spanId, transaction);
    }
  }

  onEnd(span: ReadableSpan): void {
    // Update Sentry span with OTel data and finish
    const sentrySpan = this.map.get(spanId);
    updateSpanWithOtelData(sentrySpan, span);
    sentrySpan.finish();
    this.map.delete(spanId);
  }
}
```

### Status Mapping

Map OTel status codes + HTTP/gRPC codes → Sentry status strings:

```typescript
export function mapOtelStatus(otelSpan: ReadableSpan): SentrySpanStatus {
  // OTel status code 0/1 = 'ok', 2 = error
  // For errors, check http.status_code or rpc.grpc.status_code
  // Map to Sentry canonical names: 'ok', 'permission_denied', 'internal_error', etc.
}
```

### Infinite Loop Prevention

Never send spans for requests to Sentry ingestion:

```typescript
if (isSentryRequestSpan(span, () => this.getDsnHost())) {
  this.map.delete(otelSpanId);
  return; // Skip processing
}
```

## Boundaries

- ✅ **Always do**: Follow Sentry's OpenTelemetry integration spec, filter Sentry ingestion spans, maintain minimal `SentryLike` interface
- ⚠️ **Ask first**: Breaking changes to `SentryLike` interface, changing status mapping logic
- 🚫 **Never do**: Depend on specific Sentry SDK internals, create infinite loops by sending Sentry spans to Sentry

## Testing

- **Unit tests**: `*.test.ts` (26 tests covering processor, propagator, helpers)
- Use mock factories for Sentry SDK (`mockHub`, `mockTransaction`, `mockSpan`)
- Test key scenarios: root spans, child spans, status mapping, error generation
- Verify infinite loop prevention (Sentry request spans are skipped)

## Integration Requirements

**Prerequisites for users:**
1. Sentry must be initialized **before** Autotel `init()`
2. Set `instrumenter: 'otel'` in `Sentry.init()` (so Sentry doesn't double-instrument)
3. Pass `SentrySpanProcessor` in `init({ spanProcessors: [...] })`

**Minimal setup:**
```typescript
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { createSentrySpanProcessor } from 'autotel-sentry';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  instrumenter: 'otel', // REQUIRED
});

init({
  service: 'my-app',
  spanProcessors: [createSentrySpanProcessor(Sentry)],
});
```

## References

- [Sentry: OpenTelemetry traces](https://develop.sentry.dev/sdk/telemetry/traces/opentelemetry/) - Spec this package implements
- [Sentry OTLP](https://docs.sentry.io/concepts/otlp/) - When to use OTLP direct vs SDK + OTel
- [OpenTelemetry SpanProcessor](https://opentelemetry.io/docs/instrumentation/js/instrumentation/#span-processor) - Core interface
