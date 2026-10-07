# Bunyan Logger Example

This example demonstrates how to use **Bunyan logger** with autotel for application logging with automatic trace context injection.

## What This Example Shows

- ✅ Using Bunyan for application logs with automatic trace context injection
- ✅ Bunyan auto-instrumentation via `autoInstrumentations: ['bunyan']`
- ✅ Logging with trace context automatically injected into every log record
- ✅ Error tracking with Bunyan
- ✅ Nested traces with correlated logs

## Setup

1. **Install dependencies:**

   ```bash
   cd apps/example-bunyan
   pnpm install
   ```

   **Note:** While `@opentelemetry/auto-instrumentations-node` includes Bunyan instrumentation, you may need to install `@opentelemetry/instrumentation-bunyan` separately to ensure it's available:

   ```bash
   pnpm add @opentelemetry/instrumentation-bunyan
   ```

2. **Configure OTLP endpoint (optional):**
   Create a `.env` file:

   ```bash
   OTLP_ENDPOINT=http://localhost:4318
   # Or for Grafana Cloud:
   # OTLP_ENDPOINT=https://otlp-gateway-prod-us-central-0.grafana.net/otlp
   ```

3. **Run the example:**
   ```bash
   pnpm start
   ```

## How It Works

The instrumentation patches bunyan as it loads, so `init()` must run before the logger is created. Keep them in separate modules and import telemetry first. Don't pass the logger to `init()`: that forces you to create it too early.

```typescript
// telemetry.ts
import { init } from 'autotel';
init({
  service: 'my-service',
  autoInstrumentations: ['bunyan'], // only these load; add 'http' for request spans
  logs: true, // export log records via OTLP (off by default)
});

// logger.ts
import bunyan from 'bunyan';
export const logger = bunyan.createLogger({
  name: 'my-service',
  level: 'info',
  streams: [{ stream: process.stdout }],
});

// index.ts
import './telemetry'; // first
import { logger } from './logger';

logger.info({ userId: '123' }, 'User created'); // carries trace_id/span_id inside a span
```

The start script runs `tsx --import autotel/register src/index.ts`: bunyan is loaded with `import`, which only the OTel loader hook can patch. If bunyan loads before `init()`, or an ESM app starts without the hook, autotel prints a warning at startup.

## What You'll See

When you run the example, you'll see:

1. **Bunyan logs** with trace context automatically injected:

   ```
   {"name":"example-bunyan","hostname":"...","pid":12345,"level":30,"msg":"Creating user","name":"Alice","email":"alice@example.com","trace_id":"abc123","span_id":"def456","trace_flags":"01","time":"2025-01-27T10:30:00.000Z","v":0}
   ```

2. **Traces exported to OTLP** with all spans and attributes

3. **Logs correlated with traces** - every log includes `trace_id` and `span_id` for easy correlation

## Verify Configuration

Use `autotel-cli` to verify your setup:

```bash
# From the example directory
npx autotel-cli doctor

# Or from workspace root
pnpm --filter example-bunyan exec npx autotel-cli doctor
```

This will check:

- ✅ Bunyan is installed
- ✅ Auto-instrumentation is configured
- ✅ OTLP endpoint is reachable
- ✅ Logger configuration is correct

## Key Points

1. **Bunyan auto-instrumentation** (`autoInstrumentations: ['bunyan']`) injects `trace_id`, `span_id` and `trace_flags` into every Bunyan log record.

2. **No manual wiring needed** - just enable the instrumentation and use Bunyan normally.

3. **Logs export via OTLP** - all logs with trace context are automatically exported to your observability backend (Grafana, Datadog, etc.).

4. **Bunyan signature** - Bunyan uses the same signature as Pino: `logger.info({ metadata }, 'message')`, which is compatible with autotel's Logger interface.

## Troubleshooting

**Q: My logs don't show trace_id/span_id**

A: Check the startup warnings. Usually bunyan was loaded before `init()` (create the logger in its own module, imported after telemetry), or the app is ESM and node wasn't started with `--import autotel/register`. Logs written outside a span have no trace context either.

**Q: How do I verify Bunyan instrumentation is working?**  
A: Run `npx autotel-cli doctor` - it will check your Bunyan configuration and auto-instrumentation setup.

## See Also

- [Autotel Logger Documentation](../../packages/autotel/README.md#logging-with-trace-context)
- [Bunyan Documentation](https://github.com/trentm/node-bunyan)
- [OpenTelemetry Bunyan Instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-bunyan)
