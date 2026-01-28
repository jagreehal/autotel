# Winston Logger Example

This example demonstrates how to use **Winston logger** with autotel for application logging with automatic trace context injection.

## What This Example Shows

- ✅ Using Winston for application logs with automatic trace context injection
- ✅ Winston auto-instrumentation via `autoInstrumentations: ['winston']`
- ✅ Logging with trace context automatically injected into every log record
- ✅ Error tracking with Winston
- ✅ Nested traces with correlated logs

## Setup

1. **Install dependencies:**
   ```bash
   cd apps/example-winston
   pnpm install
   ```
   
   **Note:** While `@opentelemetry/auto-instrumentations-node` includes Winston instrumentation, you may need to install `@opentelemetry/instrumentation-winston` separately to ensure it's available:
   ```bash
   pnpm add @opentelemetry/instrumentation-winston
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

```typescript
import winston from 'winston';
import { init } from 'autotel';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

// Enable Winston auto-instrumentation
init({
  service: 'my-service',
  autoInstrumentations: ['winston'], // ← This injects trace context!
});

// Use Winston normally - trace context is auto-injected!
logger.info('User created', { userId: '123' });
// Output includes: traceId, spanId, correlationId automatically!
```

## What You'll See

When you run the example, you'll see:

1. **Winston logs** with trace context automatically injected:
   ```
   2025-01-27T10:30:00.000Z [info]: Creating user {"name":"Alice","email":"alice@example.com","traceId":"abc123","spanId":"def456"}
   ```

2. **Traces exported to OTLP** with all spans and attributes

3. **Logs correlated with traces** - every log includes `traceId` and `spanId` for easy correlation

## Verify Configuration

Use `autotel-cli` to verify your setup:

```bash
# From the example directory
npx autotel doctor

# Or from workspace root
pnpm --filter example-winston exec npx autotel doctor
```

This will check:
- ✅ Winston is installed
- ✅ Auto-instrumentation is configured
- ✅ OTLP endpoint is reachable
- ✅ Logger configuration is correct

## Key Points

1. **Winston auto-instrumentation** (`autoInstrumentations: ['winston']`) automatically injects `traceId`, `spanId`, and `correlationId` into every Winston log record.

2. **No manual wiring needed** - just enable the instrumentation and use Winston normally.

3. **Logs export via OTLP** - all logs with trace context are automatically exported to your observability backend (Grafana, Datadog, etc.).

## Troubleshooting

**Q: My logs don't show traceId/spanId**  
A: Make sure `autoInstrumentations: ['winston']` is enabled in your `init()` call.

**Q: How do I verify Winston instrumentation is working?**  
A: Run `npx autotel doctor` - it will check your Winston configuration and auto-instrumentation setup.

## See Also

- [Autotel Logger Documentation](../../packages/autotel/README.md#logging-with-trace-context)
- [Winston Documentation](https://github.com/winstonjs/winston)
- [OpenTelemetry Winston Instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-winston)
