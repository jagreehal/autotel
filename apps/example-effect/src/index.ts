/**
 * Autotel + Effect example (Effect v4)
 *
 * Run: pnpm start
 *
 * A request handler that runs an Effect, which is where the two tracers have
 * to agree. autotel opens a span for the request, and the Effect's spans nest
 * under it: one trace. The app calls the route and prints what was exported.
 */

import 'dotenv/config';

import { createServer } from 'node:http';

import { flush, shutdown, trace } from 'autotel';
import type { RecordedSpan } from 'autotel/testing';
import { layer } from 'autotel-effect';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';

import { collected } from './collected-spans.js';

// A todo that does not exist is an expected outcome, not an error, and the
// queue poll is noise: neither should page anyone.
const AutotelEffect = layer({
  serviceName: 'example-effect',
  spans: {
    anticipatedErrorIdentifiers: ['TodoNotFound'],
    dropSpanSubtrees: ['queue.poll'],
  },
});

class TodoNotFound extends Data.TaggedError('TodoNotFound')<{
  message: string;
}> {}

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
  // Not exported, nor anything under it.
  Effect.tap(() => Effect.withSpan('queue.poll')(Effect.void)),
  Effect.withSpan('todo.list'),
  Effect.provide(AutotelEffect),
);

const getTodo = (id: string) =>
  pipe(
    Effect.fail(new TodoNotFound({ message: `No todo ${id}` })),
    Effect.withSpan('todo.get', { attributes: { 'todo.id': id } }),
    Effect.provide(AutotelEffect),
  );

const server = createServer((request, response) => {
  const route = request.url ?? '/';

  // Stands in for autotel's `node:http` instrumentation: whatever opens the
  // span for the request, the Effect's spans nest under it.
  void trace.run(`GET ${route}`, async () => {
    const id = /^\/api\/todos\/(\w+)$/.exec(route)?.[1];
    const exit = await Effect.runPromiseExit(id ? getTodo(id) : listTodos);
    response.statusCode = exit._tag === 'Success' ? 200 : 404;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(exit._tag === 'Success' ? exit.value : null));
  });
});

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  await new Promise<void>((resolve) =>
    server.listen(PORT, '127.0.0.1', resolve),
  );

  await fetch(`http://127.0.0.1:${PORT}/api/todos`);
  await fetch(`http://127.0.0.1:${PORT}/api/todos/99`);

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
        const status = ['', ' (ok)', ' (error)'][span.status.code] ?? '';
        console.log(`${'  '.repeat(depth + 1)}└── ${span.name}${status}`);
        printChildren(span.spanId, depth + 1);
      }
    };
    printChildren(undefined, 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
