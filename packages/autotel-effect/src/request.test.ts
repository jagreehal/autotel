import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flush, init, track } from 'autotel';
import { createMemoryExporter } from 'autotel/testing';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import {
  baggageMiddleware,
  layer,
  parseBaggage,
  runtime,
  WaitUntil,
  webHandler,
} from './index.js';

// What an app on Effect's web handler gets with no glue of its own: the browser's session id (sent as W3C baggage)
// on the server span, on every span below it and on its events; work after the response kept alive; spans flushed.

const exporter = createMemoryExporter();
const events: { name: string; attributes?: Record<string, unknown> }[] = [];

beforeAll(() => {
  init({
    service: 'autotel-effect-request-test',
    spanExporters: [exporter],
    baggage: { keys: ['session.id'] },
    events: { enrichFromBaggage: { allow: ['session.id'] } },
    subscribers: [
      {
        name: 'Recorder',
        trackEvent: async (name, attributes) => {
          events.push({ name, attributes });
        },
        trackFunnelStep: async () => {},
        trackOutcome: async () => {},
        trackValue: async () => {},
      },
    ],
    debug: false,
  });
});

afterEach(async () => {
  await flush();
  exporter.reset();
  events.length = 0;
});

const BAGGAGE = 'session.id=ph-session-1,other=ignored';

/** A route that does traced work and tracks an event, as a transfer handler would. */
const route = HttpRouter.add(
  'POST',
  '/transfer',
  Effect.gen(function* () {
    yield* Effect.sync(() => track('transfer.failed', { errorType: 'X' })).pipe(
      Effect.withSpan('validate'),
    );
    const waitUntil = yield* WaitUntil;
    waitUntil(Promise.resolve('answered later'));
    return HttpServerResponse.text('ok');
  }),
);

const handlerFor = (app: Layer.Layer<never, never, HttpRouter.HttpRouter>) =>
  HttpRouter.toWebHandler(
    app.pipe(Layer.provideMerge(layer({ serviceName: 'svc', logs: false }))),
    { disableLogger: true },
  ).handler;

const post = () =>
  new Request('http://localhost/transfer', {
    method: 'POST',
    headers: { baggage: BAGGAGE },
  });

describe('webHandler', () => {
  it('puts the session from baggage on the server span, the spans below it, and the events', async () => {
    const kept: Promise<unknown>[] = [];
    const handler = webHandler(handlerFor(route), {
      waitUntil: () => (work) => void kept.push(work),
    });

    const response = await handler(post());
    await Promise.all(kept);
    await flush();

    expect(await response.text()).toBe('ok');
    const server = exporter.spans().find((span) => span.name.includes('POST'));
    expect(server?.attributes['session.id']).toBe('ph-session-1');
    expect(exporter.findSpan('validate')?.attributes['session.id']).toBe(
      'ph-session-1',
    );
    expect(server?.attributes.other).toBeUndefined();
    expect(events).toEqual([
      expect.objectContaining({
        name: 'transfer.failed',
        attributes: expect.objectContaining({ 'session.id': 'ph-session-1' }),
      }),
    ]);
  });

  it("hands work after the response to the platform's waitUntil, flushing after it", async () => {
    const kept: Promise<unknown>[] = [];
    const handler = webHandler(handlerFor(route), {
      waitUntil: () => (work) => void kept.push(work),
    });

    await handler(post());

    // The handler's own work, and the flush after the response.
    expect(kept).toHaveLength(2);
    await expect(kept[0]).resolves.toBe('answered later');
  });

  it('flushes before returning when the platform has no waitUntil', async () => {
    const handler = webHandler(handlerFor(route), {
      waitUntil: () => undefined,
    });

    await handler(post());

    // Exported already: no flush() in the test.
    expect(exporter.findSpan('validate')).toBeDefined();
  });

  it('awaits work registered on WaitUntil before returning when the platform has no waitUntil', async () => {
    let done = false;
    const later = HttpRouter.add(
      'POST',
      '/transfer',
      Effect.gen(function* () {
        const waitUntil = yield* WaitUntil;
        waitUntil(
          new Promise((resolve) => setTimeout(resolve, 20)).then(() => {
            done = true;
          }),
        );
        return HttpServerResponse.text('ok');
      }),
    );
    const handler = webHandler(handlerFor(later), {
      waitUntil: () => undefined,
    });

    await handler(post());

    expect(done).toBe(true);
  });
});

describe('baggageMiddleware', () => {
  it('gives a long-running server the same: the session on its server span and the spans below', async () => {
    const handler = handlerFor(
      Layer.mergeAll(route, baggageMiddleware({ spanKeys: ['session.id'] })),
    );

    await handler(post());
    await flush();

    const server = exporter.spans().find((span) => span.name.includes('POST'));
    expect(server?.attributes['session.id']).toBe('ph-session-1');
    expect(exporter.findSpan('validate')?.attributes['session.id']).toBe(
      'ph-session-1',
    );
  });
});

describe('parseBaggage', () => {
  it('reads members, drops properties and malformed ones, and refuses an oversized header', () => {
    const baggage = parseBaggage('a=1;prop=x, b=%2Fpath ,bad,c=%E0%A4%A');
    expect(baggage?.getEntry('a')?.value).toBe('1');
    expect(baggage?.getEntry('b')?.value).toBe('/path');
    expect(baggage?.getEntry('bad')).toBeUndefined();
    expect(baggage?.getEntry('c')).toBeUndefined();
    expect(parseBaggage(`a=${'x'.repeat(9000)}`)).toBeUndefined();
    expect(parseBaggage(undefined)).toBeUndefined();
  });
});

describe('runtime', () => {
  it("exports a callback's spans: the layer passed in gets autotel's merged in", async () => {
    const callbacks = runtime(Layer.empty, {
      serviceName: 'bot',
      logs: false,
    });

    await callbacks.runPromise(Effect.withSpan('bot.answer')(Effect.void));
    await flush();

    expect(exporter.findSpan('bot.answer')).toBeDefined();
    await callbacks.dispose();
  });
});
