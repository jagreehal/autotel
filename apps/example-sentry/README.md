# example-sentry

Demonstrates Autotel exporting OpenTelemetry traces and logs directly to Sentry's OTLP ingestion endpoint, with Sentry error capture linked to active traces.

## How it works

```
Autotel (OTel SDK) ──OTLP──> Sentry (traces + logs)
Sentry SDK ─────────────────> Sentry (errors)
         ↑
   linkSentryErrors() attaches trace_id/span_id
```

1. `sentryOtlpConfig(dsn)` parses your Sentry DSN into an OTLP endpoint and auth headers
2. Sentry SDK is initialized with `skipOpenTelemetrySetup: true` so Autotel owns the OTel setup
3. Autotel exports traces via OTLP to Sentry's ingestion endpoint
4. `linkSentryErrors(Sentry)` installs a global event processor that attaches the active OTel `trace_id` and `span_id` to every Sentry error event

## Setup

### 1. Create a `.env` file

```bash
cp .env.example .env
```

Then fill in your Sentry DSN:

```env
SENTRY_DSN=https://<public-key>@o<org-id>.ingest.us.sentry.io/<project-id>
```

You can find your DSN in **Sentry > Settings > Projects > [your project] > Client Keys (DSN)**.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Run

```bash
# Basic run — sends a trace with a child span
pnpm start

# With error capture — also sends a linked error to Sentry
THROW_FOR_DEMO=1 pnpm start

# With debug logging
AUTOTEL_DEBUG=1 pnpm start
```

## What you'll see

### Console output

```
{"level":"info","service":"example-sentry","msg":"trace started","demo":true,"traceId":"...","spanId":"..."}
{"level":"info","service":"example-sentry","msg":"data fetched","source":"mock-api","traceId":"...","spanId":"..."}
{"level":"info","service":"example-sentry","msg":"trace finished","demo":true,"traceId":"...","spanId":"..."}
```

### In Sentry

- **Traces**: An `example-sentry-demo` transaction with a `fetch-data` child span
- **Errors** (with `THROW_FOR_DEMO=1`): A "Demo error for Sentry" error linked to the trace via matching `trace_id`

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SENTRY_DSN` | Yes | Sentry project DSN |
| `THROW_FOR_DEMO` | No | Set to `1` to capture a demo error |
| `AUTOTEL_DEBUG` | No | Set to `1` for debug logging |

## Key code

```typescript
import { sentryOtlpConfig, linkSentryErrors } from 'autotel-sentry';

const config = sentryOtlpConfig(process.env.SENTRY_DSN!);

Sentry.init({ dsn: config.dsn, skipOpenTelemetrySetup: true });
init({ service: 'example-sentry', endpoint: config.endpoint, headers: config.headers });
linkSentryErrors(Sentry);
```

## References

- [autotel-sentry](../../packages/autotel-sentry) — the helpers used in this example
- [Sentry OTLP Integration spec](https://develop.sentry.dev/sdk/telemetry/traces/otlp/)
- [Sentry OTLP docs](https://docs.sentry.io/concepts/otlp/)
