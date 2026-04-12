# autotel-sentry (Sentry OTLP Helpers)

Convenience helpers that wire Autotel's OTel SDK to Sentry's OTLP ingestion endpoint, and link Sentry error events to the active OTel trace.

## Your Role

You are working on the Sentry OTLP integration package. You understand Sentry DSN format, OTLP export configuration, OpenTelemetry context propagation (`@opentelemetry/api`), and the Sentry global event processor API.

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsup
- **Testing**: vitest
- **Key Dependencies**:
  - `@opentelemetry/api` - OTel context and active span access
  - `@sentry/node` >= 10.47.0 - Peer dependency (user-installed)

## Key Concepts

- **OTLP Configuration**: `sentryOtlpConfig(dsn)` parses a Sentry DSN into `{ dsn, endpoint, headers }` so Autotel's `init()` can export traces directly to Sentry's OTLP endpoint. No custom span processor is needed.
- **Error Linking**: `linkSentryErrors(Sentry)` installs a global Sentry event processor that reads the active OTel span and attaches `trace_id`/`span_id` to every outgoing Sentry error event.
- **Ownership Split**: Autotel owns OTel setup and trace export. Sentry SDK handles error capture only. `skipOpenTelemetrySetup: true` is required in `Sentry.init()` so the Sentry SDK does not register a second OTel SDK.
- **Minimal Interface Coupling**: `SentryLinkable` requires only `getGlobalScope()`, giving compatibility across Sentry SDK versions >= 10.47.0.

## Entry Points

Single entry point with tree-shakeable exports:

- `autotel-sentry` — `sentryOtlpConfig`, `linkSentryErrors`, `SentryOtlpConfig`, `SentryLinkable`

## Commands

```bash
# In packages/autotel-sentry directory
pnpm test               # Run tests (11 tests across config and link)
pnpm build              # Build package
pnpm lint               # Lint package
pnpm type-check         # TypeScript type checking
```

## File Structure

```
src/
├── index.ts         — Public exports
├── types.ts         — SentryOtlpConfig, SentryLinkable interfaces
├── config.ts        — sentryOtlpConfig() implementation
├── config.test.ts   — 7 tests
├── link.ts          — linkSentryErrors() implementation
└── link.test.ts     — 4 tests
```

## Code Patterns

### DSN Parsing (config.ts)

Parse the Sentry DSN URL to derive the OTLP endpoint and auth header:

```typescript
export function sentryOtlpConfig(dsn: string): SentryOtlpConfig {
  // Parse DSN, build OTLP endpoint from host + project ID
  // Return { dsn, endpoint, headers: { 'x-sentry-auth': '...' } }
}
```

### Error Linking (link.ts)

Attach the active OTel trace context to every Sentry event:

```typescript
export function linkSentryErrors(sentry: SentryLinkable): void {
  sentry.getGlobalScope().addEventProcessor((event) => {
    const span = trace.getActiveSpan();
    // merge spanContext into event.contexts.trace
    return event;
  });
}
```

## Boundaries

- Always do: Use `@opentelemetry/api` for span context (never the OTel SDK directly), keep `SentryLinkable` minimal, validate DSN input and throw clearly
- Ask first: Changing the OTLP endpoint derivation logic, adding new exports
- Never do: Depend on deprecated Sentry Hub APIs, register a SpanProcessor, register a Propagator, create the OTel TracerProvider (Autotel owns that)

## Testing

- **Unit tests**: `config.test.ts` (7 tests — DSN parsing, malformed input, header shape), `link.test.ts` (4 tests — processor installed, trace context attached, no-op when no active span)
- Use a stub for `SentryLinkable` (object with `getGlobalScope()` returning a mock scope)
- Mock `@opentelemetry/api`'s `trace.getActiveSpan()` to control span context in link tests

## Integration Requirements

**Prerequisites for users:**

1. `@sentry/node` >= 10.47.0 must be installed
2. Call `sentryOtlpConfig(dsn)` before either `Sentry.init()` or `init()`
3. Pass `skipOpenTelemetrySetup: true` to `Sentry.init()` (required — Sentry SDK v8+ registers its own OTel SDK otherwise)
4. Call `linkSentryErrors(Sentry)` after both SDKs are initialized

**Minimal setup:**

```typescript
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { linkSentryErrors, sentryOtlpConfig } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });
init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });
linkSentryErrors(Sentry);
```

## References

- [Sentry OTLP Integration spec](https://develop.sentry.dev/sdk/telemetry/traces/otlp/) — protocol this package targets
- [Sentry OTLP docs](https://docs.sentry.io/concepts/otlp/) — Sentry-side configuration
- [OpenTelemetry JS API](https://opentelemetry.io/docs/instrumentation/js/) — `trace.getActiveSpan()`
