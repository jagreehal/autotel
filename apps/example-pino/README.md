# Pino Logger Example

This example shows how to use **Pino** with autotel as the recommended, first-class logger: one Pino instance for both autotel internal logs and your application logs. No extra instrumentation package is required.

## What This Example Shows

- One Pino instance passed to `init({ logger })` and used everywhere (autotel + app)
- Pino-style signature: `logger.info({ metadata }, 'message')` — object first, message second (autotel's native logger contract)
- No `@opentelemetry/auto-instrumentations-node` or `autoInstrumentations` required; Pino works with autotel out of the box. Optional: add `autoInstrumentations: ['pino']` (and the auto-instrumentations package) if you want traceId/spanId injected into every log record for log-to-trace correlation.

## Setup

1. Install dependencies (from repo root or app):

   ```bash
   pnpm install
   ```

2. Optional: set OTLP endpoint in `.env`:

   ```bash
   OTLP_ENDPOINT=http://localhost:4318
   ```

3. Run the example:

   ```bash
   pnpm start
   ```

   Or from repo root: `pnpm --filter @jagreehal/example-pino start`

## How It Works

Create a Pino logger and pass it to `init()`. The same logger is used by autotel for its own logs and by your app. No auto-instrumentations package needed.

```typescript
import pino from 'pino';
import { init } from 'autotel';

const logger = pino({ level: 'info' });

init({
  service: 'my-app',
  logger,  // Same logger for autotel and app
});

// Pino signature: object first, message second
logger.info({ userId: '123' }, 'User created');
```

## See Also

- [Autotel logger documentation](../../packages/autotel/README.md#logging-with-trace-context)
- [Pino](https://getpino.io/)
- [OpenTelemetry Pino Instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-pino)
