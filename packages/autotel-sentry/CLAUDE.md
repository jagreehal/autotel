# autotel-sentry (Sentry OTLP Helpers)

One function: parse a Sentry DSN into the OTLP endpoint and auth headers Autotel's `init()` expects.

## Your Role

You are working on the Sentry OTLP integration package. You understand Sentry DSN format and Sentry's OTLP export configuration. The package has no runtime dependencies and calls no Sentry API.

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsup
- **Testing**: vitest
- **Key Dependencies**: none. The package is string and URL handling.

## Key Concepts

- **OTLP Configuration**: `sentryOtlpConfig(dsn)` parses a Sentry DSN into `{ dsn, endpoint, headers }` so Autotel's `init()` can export traces directly to Sentry's OTLP endpoint. No custom span processor is needed.
- **Ownership Split**: Autotel owns OTel setup and trace export. Sentry SDK handles error capture only. `skipOpenTelemetrySetup: true` is required in `Sentry.init()` so the Sentry SDK does not register a second OTel SDK.
- **Error linking is Sentry's job**: `@sentry/node` bundles `@sentry/opentelemetry` and reads the active OTel span when building an event's trace context, so errors carry the right ids with no help from us. `skipOpenTelemetrySetup: true` does not change this. A `linkSentryErrors()` export used to duplicate it and was removed in 0.7.0. Do not reintroduce it.
- **Overlap with Sentry**: `otlpIntegration` (`@sentry/node-core/light/otlp`, since 10.47.0) does both jobs. It defaults to installing its own exporter, which double-exports when autotel already exports. Pair it with `setupOtlpTracesExporter: false` or use this package, never both.

## Entry Points

Single entry point with tree-shakeable exports:

- `autotel-sentry`: `sentryOtlpConfig`, `SentryOtlpConfig`

## Commands

```bash
# In packages/autotel-sentry directory
pnpm test               # Run tests (7 tests, all DSN parsing)
pnpm build              # Build package
pnpm lint               # Lint package
pnpm type-check         # TypeScript type checking
```

## File Structure

```
src/
├── index.ts         — Public exports
├── types.ts         — SentryOtlpConfig interface
├── config.ts        — sentryOtlpConfig() implementation
└── config.test.ts   — 7 tests
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

## Boundaries

- Always do: Validate DSN input and throw clearly, keep the package dependency-free
- Ask first: Changing the OTLP endpoint derivation logic, adding new exports
- Never do: Add a Sentry dependency, register a SpanProcessor or Propagator, create the OTel TracerProvider (Autotel owns that), reintroduce an error-linking helper

## Testing

- **Unit tests**: `config.test.ts` (7 tests: DSN parsing, malformed input, header shape). That is the whole surface.

## Integration Requirements

**Prerequisites for users:**

1. `@sentry/node` must be installed (by the user; this package does not depend on it)
2. Call `sentryOtlpConfig(dsn)` before either `Sentry.init()` or `init()`
3. Pass `skipOpenTelemetrySetup: true` to `Sentry.init()` (required: Sentry SDK v8+ registers its own OTel SDK otherwise)

**Minimal setup:**

```typescript
import * as Sentry from '@sentry/node';
import { init } from 'autotel';
import { sentryOtlpConfig } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });
init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });
```

## References

- [Sentry OTLP Integration spec](https://develop.sentry.dev/sdk/telemetry/traces/otlp/): protocol this package targets
- [Sentry OTLP docs](https://docs.sentry.io/concepts/otlp/): Sentry-side configuration
