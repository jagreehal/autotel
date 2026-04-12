# autotel-sentry

Convenience helpers for sending Autotel (OpenTelemetry) traces to Sentry via OTLP. The package parses a Sentry DSN into the OTLP endpoint and auth headers that Autotel's `init()` expects, and installs a global Sentry event processor that attaches the active OTel `trace_id` and `span_id` to every Sentry error event so errors and traces are linked in the Sentry UI.

## Prerequisites

- Node.js 22+
- `@sentry/node` >= 10.47.0 (exposes `getGlobalScope`)
- `autotel` (peer dependency)

## Installation

```bash
pnpm add autotel autotel-sentry @sentry/node
```

## Quick start

```typescript
import * as Sentry from '@sentry/node';
import { init, shutdown, trace } from 'autotel';
import { linkSentryErrors, sentryOtlpConfig } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

// 1. Initialize Sentry — tell it not to register its own OTel SDK
Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });

// 2. Initialize Autotel — it owns OTel and exports traces to Sentry's OTLP endpoint
init({ service: 'my-app', endpoint: config.endpoint, headers: config.headers });

// 3. Link Sentry errors to the active OTel trace
linkSentryErrors(Sentry);
```

`skipOpenTelemetrySetup: true` is required because Sentry SDK v8+ registers its own OTel SDK internally. Autotel owns OTel setup; without this flag you get duplicate span processors and broken traces.

## API reference

### `sentryOtlpConfig(dsn: string): SentryOtlpConfig`

Parses a Sentry DSN and returns the three values needed to wire Autotel to Sentry's OTLP ingestion endpoint.

```typescript
const config = sentryOtlpConfig('https://<key>@o<org>.ingest.sentry.io/<project>');
// config.dsn      — normalized DSN string (pass to Sentry.init)
// config.endpoint — OTLP base URL (pass to Autotel init as `endpoint`)
// config.headers  — auth headers (pass to Autotel init as `headers`)
```

Throws if the DSN is missing or cannot be parsed.

### `linkSentryErrors(sentry: SentryLinkable): void`

Installs a global Sentry event processor that reads the active OTel span from `@opentelemetry/api` and merges `trace_id` and `span_id` into every outgoing Sentry event's `contexts.trace`. Call this once, after both `Sentry.init()` and `init()`.

### Type: `SentryOtlpConfig`

```typescript
interface SentryOtlpConfig {
  dsn: string;                       // Normalized DSN for Sentry.init
  endpoint: string;                  // OTLP base endpoint (Autotel appends /v1/traces)
  headers: Record<string, string>;   // Auth headers for OTLP requests
}
```

### Type: `SentryLinkable`

Minimal interface required by `linkSentryErrors()`. `@sentry/node` >= 10.47.0 satisfies it automatically.

```typescript
interface SentryLinkable {
  getGlobalScope(): {
    addEventProcessor(fn: (event: Record<string, unknown>) => Record<string, unknown>): void;
  };
}
```

## Migration from SpanProcessor approach

Earlier versions of this package used a `SentrySpanProcessor` / `SentryPropagator` bridge that relied on deprecated Sentry Hub APIs. That approach is removed.

Sentry SDK v8+ ships with its own OTel SDK internally. The recommended path is now to let Autotel own OTel and export traces directly to Sentry's OTLP endpoint — no custom span processor needed. Remove any references to `createSentrySpanProcessor`, `SentrySpanProcessor`, `SentryPropagator`, and `instrumenter: 'otel'` from your setup and replace them with the quick start above.

## References

- [Sentry OTLP Integration spec](https://develop.sentry.dev/sdk/telemetry/traces/otlp/) — protocol this package targets
- [Sentry OTLP docs](https://docs.sentry.io/concepts/otlp/) — Sentry-side OTLP configuration
- [Autotel](https://github.com/jagreehal/autotel) — `init()` and `endpoint`/`headers` options
