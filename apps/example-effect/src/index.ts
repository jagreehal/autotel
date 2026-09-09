/**
 * Autotel + Effect example (Effect v4)
 *
 * Run: pnpm start
 *
 * A request handler that runs an Effect, which is where the two tracers have
 * to agree. autotel opens a span for the request; Effect takes a span's parent
 * from its own `Tracer.ParentSpan`, not from the ambient OpenTelemetry context,
 * so `Effect.runPromise` on its own opens a *second, unrelated trace*.
 * `withAutotel` hands Effect the active autotel span as the parent.
 *
 * Both routes are served here so the difference is visible: the app calls each
 * one and prints what was exported.
 */

import 'dotenv/config';

import { createServer } from 'node:http';

import { flush, shutdown, trace } from 'autotel';
import type { RecordedSpan } from 'autotel/testing';
import { layer, withAutotel } from 'autotel-effect';
import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';

import { collected } from './collected-spans.js';

const AutotelEffect = layer({ serviceName: 'example-effect' });

/**
 * Domain work, described once at startup — the shape that makes the parent
 * lookup interesting, since there is no span active when this is built.
 */
const listTodos = pipe(
  Effect.succeed([
    { id: 1, title: 'Write the handler' },
    { id: 2, title: 'Check the trace' },
  ]),
  Effect.tap(() => Effect.log('listed todos')),
  Effect.withSpan('db.query', { attributes: { 'db.system': 'postgresql' } }),
  Effect.withSpan('todo.list'),
  Effect.provide(AutotelEffect),
);

const server = createServer((request, response) => {
  const route = request.url ?? '/';

  // Stands in for autotel's `node:http` instrumentation: whatever opens the
  // span for the request, `withAutotel` picks it up from the active context.
  void trace.run(`GET ${route}`, async () => {
    const todos = await Effect.runPromise(
      // The whole difference between the two routes.
      route === '/api/todos/detached' ? listTodos : withAutotel(listTodos),
    );
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(todos));
  });
});

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  await new Promise<void>((resolve) =>
    server.listen(PORT, '127.0.0.1', resolve),
  );

  await fetch(`http://127.0.0.1:${PORT}/api/todos`);
  await fetch(`http://127.0.0.1:${PORT}/api/todos/detached`);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await flush();

  printTraces(collected.spans());

  await shutdown();
  process.exit(0);
}

/** Prints what was exported, grouped by trace and nested by parent. */
function printTraces(spans: RecordedSpan[]): void {
  const traceIds = [...new Set(spans.map((span) => span.traceId))];

  for (const traceId of traceIds) {
    const inTrace = spans.filter((span) => span.traceId === traceId);
    console.log(`\ntrace ${traceId}`);

    const printChildren = (parentSpanId: string | undefined, depth: number) => {
      for (const span of inTrace.filter(
        (candidate) => candidate.parentSpanId === parentSpanId,
      )) {
        console.log(`${'  '.repeat(depth + 1)}└── ${span.name}`);
        printChildren(span.spanId, depth + 1);
      }
    };
    printChildren(undefined, 0);
  }

  console.log(
    '\n/api/todos ran the effect with withAutotel: one trace.' +
      '\n/api/todos/detached ran it without: the request span and the Effect' +
      ' spans landed in different traces.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
