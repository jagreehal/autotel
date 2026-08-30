/**
 * Autotel + Effect example (Effect v4)
 *
 * Run: pnpm start
 *
 * autotel.init() runs in instrumentation.ts (via --import). autotel-effect
 * provides Effect's Tracer from that global provider; all Effect.withSpan spans
 * export through autotel.
 */

import 'dotenv/config';

import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';
import { flush, shutdown } from 'autotel';
import { layer } from 'autotel-effect';

const AutotelEffect = layer({ serviceName: 'example-effect' });

const program = pipe(
  Effect.log('Hello from Effect'),
  Effect.withSpan('step-b'),
  Effect.withSpan('step-a'),
  Effect.withSpan('example-effect'),
);

async function main() {
  await pipe(
    program,
    Effect.provide(AutotelEffect),
    Effect.catchCause(Effect.logError),
    Effect.runPromise,
  );
  await flush();
  await shutdown();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
