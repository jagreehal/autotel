# Autotel + Effect Example

Minimal [Effect v4](https://effect.website/) app with [autotel](https://github.com/jagreehal/autotel) export and [`autotel-effect`](../../packages/autotel-effect) bridging `Effect.withSpan` to the global OpenTelemetry provider.

## Try it

```bash
pnpm install
pnpm start
```

From the monorepo root:

```bash
pnpm --filter @jagreehal/example-effect start
```

Without an OTLP endpoint, autotel logs spans to the console (`debug: true` in `instrumentation.ts`).

## How it works

1. **`instrumentation.ts` runs first** — loaded via `tsx --import ./instrumentation.ts`. Calls `autotel.init()` and registers the global `TracerProvider`.

2. **`autotel-effect` provides Effect's tracer** — `layer({ serviceName: 'example-effect' })` wires `OtelTracer.layerGlobal` to that provider. No Effect NodeSdk or OTLP layer in the app.

3. **Spans export through autotel** — `Effect.withSpan(...)` in the program creates spans on the global provider; autotel handles OTLP/console export.

## Snippets

### Initialize autotel (before any Effect code)

```typescript
// instrumentation.ts
import { init } from 'autotel';

init({
  service: 'example-effect',
  debug: true,
  endpoint:
    process.env.OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
```

```bash
tsx --import ./instrumentation.ts src/index.ts
```

### Run traced Effect code

```typescript
import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';
import { layer } from 'autotel-effect';

const AutotelEffect = layer({ serviceName: 'example-effect' });

const program = pipe(
  Effect.log('Hello from Effect'),
  Effect.withSpan('step-b'),
  Effect.withSpan('step-a'),
  Effect.withSpan('example-effect'),
);

await pipe(program, Effect.provide(AutotelEffect), Effect.runPromise);
```

## Learn more

- [autotel-effect](../../packages/autotel-effect)
- [autotel](https://github.com/jagreehal/autotel)
- [Effect](https://effect.website/)
- [@effect/opentelemetry](https://github.com/Effect-TS/effect/tree/main/packages/opentelemetry)
