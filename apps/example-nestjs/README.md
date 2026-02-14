# NestJS + autotel Example

This example shows how to use [NestJS](https://nestjs.com) with autotel for HTTP and Nest automatic instrumentation, plus manual tracing in services.

## What This Example Shows

- NestJS app with autotel initialized before bootstrap
- `autoInstrumentations: ['http', 'nestjs-core']` for automatic server spans
- Manual `trace()` in services for custom spans (e.g. DB calls)
- Controller routes: health, users/:userId, users/:userId/orders, error

## Setup

1. From repo root: `pnpm install`
2. Optional: set `OTLP_ENDPOINT` or `PORT` in `.env`
3. Run: `pnpm start` (builds then runs; or from root: `pnpm --filter @jagreehal/example-nestjs start`)
4. For dev with tsx (no decorator metadata): `pnpm start:dev` — routes work but DI may fail; use `pnpm start` for full behavior.

## How It Works

Autotel is initialized in `instrumentation.ts` (loaded via `--import`) with HTTP and NestJS-core auto-instrumentation. Each request is traced automatically; use `trace()` from autotel in services for additional spans.

```typescript
// instrumentation.ts
import { init } from 'autotel';
init({ service: 'my-app', autoInstrumentations: ['http', 'nestjs-core'] });

// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
const app = await NestFactory.create(AppModule);
await app.listen(3000);
```

## See Also

- [autotel](../../packages/autotel)
- [NestJS](https://nestjs.com)
- [OpenTelemetry NestJS Instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-nestjs-core)
