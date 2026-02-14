/**
 * Autotel + Effect example
 *
 * Run: pnpm start
 *
 * Autotel is initialized in instrumentation.ts (loaded via --import).
 * This program uses Effect's Tracer backed by the global OTel provider (autotel),
 * so all Effect.withSpan spans are recorded and exported by autotel.
 */

import 'dotenv/config';

import * as Resource from '@effect/opentelemetry/Resource';
import * as Tracer from '@effect/opentelemetry/Tracer';
import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';
import * as Layer from 'effect/Layer';
import { shutdown } from 'autotel';

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

async function main() {
  await pipe(
    program,
    Effect.provide(AutotelEffectLive),
    Effect.catchAllCause(Effect.logError),
    Effect.runPromise,
  );
  await shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
