# Pino Logger Example

This example shows Pino with autotel: `autoInstrumentations: ['pino']` adds `trace_id` / `span_id` to every log record and exports it via OTLP.

## What This Example Shows

- `init()` in its own module (`src/telemetry.ts`), imported first
- The Pino logger created in another module (`src/logger.ts`), after `init()` has run, so the instrumentation patches pino as it loads
- The logger is **not** passed to `init()`. That option is only for autotel's own diagnostics, and passing it forces you to create pino too early
- `--import autotel/register` in the start script: pino is loaded with `import`, which only the OTel loader hook can patch

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

```typescript
// telemetry.ts
import { init } from 'autotel';
init({ service: 'my-app', autoInstrumentations: ['pino'], logs: true });

// logger.ts
import pino from 'pino';
export const logger = pino({ level: 'info' });

// index.ts
import './telemetry'; // first
import { logger } from './logger';

logger.info({ userId: '123' }, 'User created'); // carries trace_id/span_id inside a span
```

```bash
node --import autotel/register dist/index.js   # or: tsx --import autotel/register src/index.ts
```

Needs `@opentelemetry/auto-instrumentations-node` installed. If pino loads before `init()`, or an ESM app starts without `--import autotel/register`, autotel prints a warning at startup.

## See Also

- [Autotel logger documentation](../../packages/autotel/README.md#logging-with-trace-context)
- [Pino](https://getpino.io/)
- [OpenTelemetry Pino Instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-pino)
