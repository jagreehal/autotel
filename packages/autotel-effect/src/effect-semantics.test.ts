import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  context as otelContext,
  createTraceState,
  trace as otelTrace,
} from '@opentelemetry/api';
import { flush, getActiveTraceContext, init, trace } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as ErrorReporter from 'effect/ErrorReporter';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as References from 'effect/References';
import { effectSpanFilter, layer } from './index.js';

const exporter = new InMemorySpanExporter();
type ReadableSpan = ReturnType<
  InMemorySpanExporter['getFinishedSpans']
>[number];

beforeAll(() => {
  init({
    service: 'autotel-effect-semantics-test',
    spanExporters: [exporter],
    spanFilter: effectSpanFilter({
      dropSpanNames: ['queue.tick'],
      dropSpan: (span) => span.attributes['queue.empty'] === true,
    }),
    debug: false,
  });
});

afterEach(async () => {
  await flush();
  exporter.reset();
});

class NotFound extends Data.TaggedError('NotFound')<{ message: string }> {}
class DuplicateKey extends Data.TaggedError('DuplicateKey')<{
  message: string;
}> {}
class PaymentDeclined extends Data.TaggedError('PaymentDeclined')<{
  message: string;
  why: string;
  fix: string;
  status: number;
}> {}

const Autotel = layer({
  serviceName: 'semantics',
  logs: false,
  spans: {
    anticipatedErrorIdentifiers: ['NotFound'],
    isAnticipatedError: (error) => error instanceof DuplicateKey,
    dropSpanSubtrees: ['queue.poll'],
  },
});

async function run<A, E>(program: Effect.Effect<A, E>) {
  await Effect.runPromiseExit(program.pipe(Effect.provide(Autotel)));
  await flush();
}

function span(name: string): ReadableSpan {
  const found = exporter.getFinishedSpans().find((s) => s.name === name);
  if (!found) throw new Error(`no span named ${name}`);
  return found;
}

const exceptions = (s: ReadableSpan) =>
  s.events.filter((event) => event.name === 'exception');

describe('exit classification', () => {
  it('keeps an anticipated tag OK, with no exception', async () => {
    await run(
      Effect.withSpan('user.get')(
        Effect.fail(new NotFound({ message: 'no user 7' })),
      ),
    );
    expect(span('user.get').status.code).toBe(1);
    expect(exceptions(span('user.get'))).toHaveLength(0);
  });

  it('keeps a failure the predicate expects OK', async () => {
    await run(
      Effect.withSpan('user.insert')(
        Effect.fail(new DuplicateKey({ message: 'taken' })),
      ),
    );
    expect(span('user.insert').status.code).toBe(1);
    expect(exceptions(span('user.insert'))).toHaveLength(0);
  });

  it('keeps a failure Effect marks ErrorReporter.ignore OK', async () => {
    const ignored = { _tag: 'RouteNotFound', [ErrorReporter.ignore]: true };
    await run(Effect.withSpan('route')(Effect.fail(ignored)));
    expect(span('route').status.code).toBe(1);
  });

  it('records a defect as an error with its exception and error.type', async () => {
    await run(Effect.withSpan('boom')(Effect.die(new TypeError('bad state'))));
    const s = span('boom');
    expect(s.status.code).toBe(2);
    expect(exceptions(s)[0]?.attributes?.['exception.type']).toBe('TypeError');
    expect(s.attributes['error.type']).toBe('TypeError');
  });

  it('makes a server span that answered 5xx an error', async () => {
    await run(
      Effect.withSpan('GET /orders', {
        kind: 'server',
        attributes: {
          'http.response.status_code': 503,
          'http.request.method': 'GET',
          'url.path': '/orders',
        },
      })(Effect.void),
    );
    const s = span('GET /orders');
    expect(s.status.code).toBe(2);
    expect(s.attributes['error.type']).toBe('503');
    expect(exceptions(s)[0]?.attributes?.['exception.type']).toBe(
      'HttpServerErrorResponse',
    );
  });

  it('does not let an anticipated tag silence a 5xx', async () => {
    await run(
      Effect.withSpan('GET /users/7', {
        kind: 'server',
        attributes: { 'http.response.status_code': 500 },
      })(Effect.fail(new NotFound({ message: 'lookup crashed' }))),
    );
    expect(span('GET /users/7').status.code).toBe(2);
  });

  it('marks a client 4xx an error without an exception', async () => {
    const statusCodeError = {
      _tag: 'HttpClientError',
      reason: { _tag: 'StatusCodeError', response: { status: 404 } },
    };
    await run(
      Effect.withSpan('GET api.example', { kind: 'client' })(
        Effect.fail(statusCodeError),
      ),
    );
    const s = span('GET api.example');
    expect(s.status.code).toBe(2);
    expect(s.attributes['error.type']).toBe('404');
    expect(exceptions(s)).toHaveLength(0);
  });

  it('matches an anticipated tag inside an { error } envelope', async () => {
    await run(
      Effect.withSpan('api.call')(Effect.fail({ error: { _tag: 'NotFound' } })),
    );
    expect(span('api.call').status.code).toBe(1);
  });

  it('keeps an exception the handler recorded on a 5xx server span', async () => {
    await run(
      Effect.withSpan('POST /pay', {
        kind: 'server',
        attributes: { 'http.response.status_code': 500 },
      })(
        Effect.currentSpan.pipe(
          Effect.tap((s) =>
            Effect.sync(() =>
              s.event('exception', 0n, { 'exception.type': 'StripeTimeout' }),
            ),
          ),
        ),
      ),
    );
    const s = span('POST /pay');
    expect(s.status.code).toBe(2);
    expect(exceptions(s).map((e) => e.attributes?.['exception.type'])).toEqual([
      'StripeTimeout',
    ]);
  });

  it('names error.type after an HttpClientError reason', async () => {
    const transport = {
      _tag: 'HttpClientError',
      reason: { _tag: 'TransportError' },
    };
    await run(
      Effect.withSpan('GET down', { kind: 'client' })(Effect.fail(transport)),
    );
    expect(span('GET down').attributes['error.type']).toBe('TransportError');
  });

  it('leaves an interrupted span unflagged', async () => {
    await run(Effect.withSpan('cancelled')(Effect.interrupt));
    const s = span('cancelled');
    expect(s.status.code).not.toBe(2);
    expect(s.attributes['effect.fiber.interrupted']).toBe(true);
  });

  it('carries a TaggedError structured fields onto the span', async () => {
    await run(
      Effect.withSpan('checkout')(
        Effect.fail(
          new PaymentDeclined({
            message: 'Payment failed',
            why: 'Card declined by issuer',
            fix: 'Try another card',
            status: 402,
          }),
        ),
      ),
    );
    const s = span('checkout');
    expect(s.status.code).toBe(2);
    expect(s.attributes['error.why']).toBe('Card declined by issuer');
    expect(s.attributes['error.fix']).toBe('Try another card');
    expect(s.attributes['error.status']).toBe(402);
    expect(s.attributes['error.type']).toBe('PaymentDeclined');
  });
});

describe('dropping spans', () => {
  it('drops a subtree, Effect and non-Effect children included', async () => {
    await run(
      Effect.withSpan('job')(
        Effect.all([
          Effect.withSpan('queue.poll')(
            Effect.withSpan('db.select')(
              Effect.promise(() =>
                trace.run('fetch.queue', async () => 'none'),
              ),
            ),
          ),
          Effect.withSpan('job.work')(Effect.void),
        ]),
      ),
    );
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain('job');
    expect(names).toContain('job.work');
    expect(names).not.toContain('queue.poll');
    expect(names).not.toContain('db.select');
    expect(names).not.toContain('fetch.queue');
  });

  it('keeps the parent tracestate inside a dropped subtree', async () => {
    const remote = otelTrace.setSpanContext(otelContext.active(), {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
      isRemote: true,
      traceState: createTraceState('vendor=xyz'),
    });
    let seen: string | undefined;
    await otelContext.with(remote, () =>
      run(
        Effect.withSpan('queue.poll')(
          Effect.sync(() => {
            seen = otelTrace
              .getSpanContext(otelContext.active())
              ?.traceState?.serialize();
          }),
        ),
      ),
    );
    expect(seen).toBe('vendor=xyz');
  });

  it('drops forked children of a dropped subtree', async () => {
    await run(
      Effect.withSpan('queue.poll')(
        Effect.forkChild(Effect.withSpan('poll.forked')(Effect.void)).pipe(
          Effect.flatMap(Fiber.join),
        ),
      ),
    );
    expect(exporter.getFinishedSpans().map((s) => s.name)).not.toContain(
      'poll.forked',
    );
  });

  it('leaves a span below the minimum trace level unexported', async () => {
    await run(
      Effect.withSpan('kept')(
        Effect.withSpan('chatty', { level: 'Debug' })(
          Effect.withSpan('chatty.child')(Effect.void),
        ),
      ).pipe(Effect.provideService(References.MinimumTraceLevel, 'Info')),
    );
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain('kept');
    expect(names).not.toContain('chatty');
    expect(names).not.toContain('chatty.child');
  });

  it('drops a single span and re-parents its child to the nearest kept span', async () => {
    await run(
      Effect.withSpan('worker')(
        Effect.withSpan('queue.tick')(
          Effect.withSpan('process.message')(Effect.void),
        ),
      ),
    );
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).not.toContain('queue.tick');
    expect(span('process.message').parentSpanContext?.spanId).toBe(
      span('worker').spanContext().spanId,
    );
  });

  it('drops spans a predicate matches, and only Effect spans', async () => {
    // Under a parent: a filtered local root drops its whole subtree by design.
    await run(
      Effect.withSpan('consumer')(
        Effect.withSpan('poll', { attributes: { 'queue.empty': true } })(
          Effect.promise(() =>
            trace.run('http.outbound', async (ctx) =>
              ctx.setAttribute('queue.empty', true),
            ),
          ),
        ),
      ),
    );
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).not.toContain('poll');
    expect(names).toContain('http.outbound');
  });
});

describe('one trace across Effect and autotel', () => {
  it('parents an Effect span under the surrounding autotel span, with semantics on', async () => {
    await trace.run('GET /todos', async () => {
      await Effect.runPromiseExit(
        Effect.withSpan('todo.list')(
          Effect.fail(new NotFound({ message: 'empty' })),
        ).pipe(Effect.provide(Autotel)),
      );
    });
    await flush();
    const parent = span('GET /todos');
    const child = span('todo.list');
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });

  it("lets autotel's ambient context annotate the Effect span it runs under", async () => {
    await run(
      Effect.withSpan('order.place')(
        Effect.sync(() =>
          getActiveTraceContext()?.setAttribute('order.id', 'o-1'),
        ),
      ),
    );
    expect(span('order.place').attributes['order.id']).toBe('o-1');
  });

  it('parents an autotel span started inside an Effect span', async () => {
    await run(
      Effect.withSpan('order.charge')(
        Effect.promise(() => trace.run('stripe.charge', async () => 'ok')),
      ),
    );
    expect(span('stripe.charge').parentSpanContext?.spanId).toBe(
      span('order.charge').spanContext().spanId,
    );
  });

  it('layers merged into an app keep classification', async () => {
    const app = Layer.empty.pipe(Layer.provideMerge(Autotel));
    await Effect.runPromiseExit(
      Effect.withSpan('merged')(
        Effect.fail(new NotFound({ message: 'x' })),
      ).pipe(Effect.provide(app)),
    );
    await flush();
    expect(span('merged').status.code).toBe(1);
  });
});
