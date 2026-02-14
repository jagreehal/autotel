# Autotel + Effect Example

Minimal example of using [Effect](https://effect.website) with [autotel](https://github.com/jagreehal/autotel): autotel configures OpenTelemetry and exports spans; Effect's runtime uses the global tracer so all `Effect.withSpan` spans go through autotel.

## Try it

```bash
pnpm install
pnpm start
```

From repo root you can run `pnpm --filter @jagreehal/example-effect start`. Without an OTLP endpoint, autotel logs spans to the console (when `debug: true`).

## How it works

1. **Autotel runs first**  
   `instrumentation.ts` is loaded via `tsx --import ./instrumentation.ts src/index.ts` and calls `autotel.init()`. That registers the global OpenTelemetry `TracerProvider` (NodeSDK).

2. **Effect uses the global tracer**  
   The app builds a Layer that provides Effect's `Tracer` from the global OTel API (`Tracer.layerGlobal` from `@effect/opentelemetry`) and the OTel `Resource` (`Resource.layer` with `serviceName: 'example-effect'`). No Effect NodeSdk or OTLP layer — autotel handles export.

3. **Spans are recorded by autotel**  
   Any `Effect.withSpan(...)` in the program creates spans that go to the global provider, so they are processed and exported by autotel (OTLP, console, etc.) according to your autotel config.

## Copy-paste snippets

### Initialize autotel (before any Effect code)

```typescript
// instrumentation.ts
import { init } from 'autotel';

init({
  service: 'example-effect',
  debug: true,
  endpoint: process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
```

Run the app with: `tsx --import ./instrumentation.ts src/index.ts`

### Provide Effect Tracer from global provider and run a traced effect

```typescript
import * as Resource from '@effect/opentelemetry/Resource';
import * as Tracer from '@effect/opentelemetry/Tracer';
import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';
import * as Layer from 'effect/Layer';

const AutotelEffectLive = pipe(
  Tracer.layerGlobal,
  Layer.provide(Resource.layer({ serviceName: 'example-effect' })),
);

const program = pipe(
  Effect.log('Hello from Effect'),
  Effect.withSpan('step-b'),
  Effect.withSpan('step-a'),
  Effect.withSpan('example-effect'),
);

pipe(
  program,
  Effect.provide(AutotelEffectLive),
  Effect.catchAllCause(Effect.logError),
  Effect.runPromise,
);
```

## Learn more

- [autotel](https://github.com/jagreehal/autotel) — OpenTelemetry setup and conventions
- [Effect](https://effect.website) — TypeScript effect system
- [@effect/opentelemetry](https://github.com/Effect-TS/effect/tree/main/packages/opentelemetry) — Effect's OpenTelemetry integration
