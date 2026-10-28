// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { datadogRum } from '@datadog/browser-rum';
import { clearBaggage, getBaggageEntries } from 'autotel-web/baggage';
import { rememberRequestSpan, resetJoinForTesting } from 'autotel-web/join';
import {
  joinDatadog,
  type DatadogRumLike,
  type JoinDatadogOptions,
  type RumEventLike,
} from './index';

// Compile-time contract: the structural type accepts the real SDK. The
// runtime half (RUM's beforeSend allowlist keeping `context`) runs in a real
// browser: apps/example-datadog `pnpm smoke:web`.
const real: DatadogRumLike = datadogRum;
void real;

afterEach(() => {
  resetJoinForTesting();
  clearBaggage();
  vi.restoreAllMocks();
});

const REPLAY = 'https://app.datadoghq.eu/rum/replay/sessions/s1?seed=v1&from=1';

function fakeRum(overrides: Partial<DatadogRumLike> = {}): DatadogRumLike {
  return {
    getInternalContext: () => ({ session_id: 's1' }),
    getUser: () => ({ id: 'u1' }),
    getSessionReplayLink: () => REPLAY,
    ...overrides,
  };
}

function setup(rum: DatadogRumLike, options: JoinDatadogOptions = {}) {
  const join = joinDatadog(rum, { debug: false, ...options });
  const ended: ReadableSpan[] = [];
  const recorder: SpanProcessor = {
    onStart() {},
    onEnd: (span) => ended.push(span),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
  const tracer = new BasicTracerProvider({
    spanProcessors: [join, recorder],
  }).getTracer('t');
  return { join, tracer, ended };
}

const failed = (tracer: ReturnType<typeof setup>['tracer'], name = 'x') => {
  const span = tracer.startSpan(name);
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
};

describe('RUM errors', () => {
  it('carry the trace in flight, in the forms Datadog APM uses', () => {
    const { join, tracer } = setup(fakeRum(), {
      traceUrl: ({ traceId }) =>
        `https://app.datadoghq.eu/apm/trace/${traceId}`,
    });
    const span = tracer.startSpan('checkout');
    const { traceId, spanId } = span.spanContext();
    const event: RumEventLike = { type: 'error', context: { page: 'cart' } };

    expect(join.beforeSend(event)).toBe(true);
    expect(event.context).toEqual({
      page: 'cart',
      trace_id: traceId,
      span_id: BigInt(`0x${spanId}`).toString(10),
      trace_url: `https://app.datadoghq.eu/apm/trace/${traceId}`,
    });
  });

  it('carry the trace of the request a failed call came from', () => {
    // TanStack's onError runs after the request span ended; the axios error
    // RUM hands to beforeSend still holds the XHR.
    const { join } = setup(fakeRum());
    const xhr = {};
    const request = {
      traceId: 'e'.repeat(32),
      spanId: '0'.repeat(15) + 'f',
      traceFlags: 1,
    };
    rememberRequestSpan(xhr, request);
    const event: RumEventLike = { type: 'error' };
    join.beforeSend(event, { error: { request: xhr } });
    expect(event.context).toMatchObject({
      trace_id: request.traceId,
      span_id: '15',
    });
  });

  it('keep a trace the app passed, without another trace’s span or link', () => {
    // App passes trace A while trace B is in flight: nothing from B may land
    // on the event, or the link opens B.
    const { join, tracer } = setup(fakeRum(), {
      traceUrl: ({ traceId, spanId }) => `https://t/${traceId}/${spanId}`,
    });
    tracer.startSpan('trace B');
    const event: RumEventLike = {
      type: 'error',
      context: { trace_id: 'a'.repeat(32) },
    };
    join.beforeSend(event);
    expect(event.context).toEqual({
      trace_id: 'a'.repeat(32),
      trace_url: `https://t/${'a'.repeat(32)}/`,
    });
  });

  it('link a passed trace by the span id passed with it', () => {
    const { join } = setup(fakeRum(), {
      traceUrl: ({ traceId, spanId }) => `https://t/${traceId}/${spanId}`,
    });
    const event: RumEventLike = {
      type: 'error',
      context: { trace_id: 'a'.repeat(32), span_id: '255' },
    };
    join.beforeSend(event);
    expect(event.context?.span_id).toBe('255');
    expect(event.context?.trace_url).toBe(
      `https://t/${'a'.repeat(32)}/00000000000000ff`,
    );
  });

  it('fill the span id when the span in flight is in the passed trace', () => {
    const { join, tracer } = setup(fakeRum());
    const span = tracer.startSpan('checkout');
    const { traceId, spanId } = span.spanContext();
    const event: RumEventLike = {
      type: 'error',
      context: { trace_id: traceId },
    };
    join.beforeSend(event);
    expect(event.context?.span_id).toBe(BigInt(`0x${spanId}`).toString(10));
  });

  it('leave every other event type alone', () => {
    const { join, tracer } = setup(fakeRum());
    tracer.startSpan('checkout');
    const event: RumEventLike = { type: 'resource' };
    expect(join.beforeSend(event)).toBe(true);
    expect(event.context).toBeUndefined();
  });

  it('get nothing when two traces are in flight', () => {
    const { join, tracer } = setup(fakeRum());
    tracer.startSpan('a');
    tracer.startSpan('b');
    const event: RumEventLike = { type: 'error' };
    join.beforeSend(event);
    expect(event.context).toBeUndefined();
  });

  it('are never dropped, whatever throws', () => {
    const { join, tracer } = setup(fakeRum(), {
      traceUrl: () => {
        throw new Error('app');
      },
    });
    tracer.startSpan('x');
    expect(join.beforeSend({ type: 'error' })).toBe(true);
  });
});

describe('spans', () => {
  it('carry the RUM session and user, and send the session as baggage', () => {
    const { tracer, ended } = setup(fakeRum());
    tracer.startSpan('x').end();
    expect(ended[0]?.attributes).toMatchObject({
      'session.id': 's1',
      'user.id': 'u1',
    });
    expect(getBaggageEntries()['session.id']).toBe('s1');
  });

  it('get the replay link only when they failed', () => {
    const { tracer, ended } = setup(fakeRum());
    tracer.startSpan('ok').end();
    failed(tracer, 'bad');
    const link = (name: string) =>
      ended.find((s) => s.name === name)?.attributes['session.replay.url'];
    expect(link('ok')).toBeUndefined();
    expect(link('bad')).toBe(REPLAY);
  });

  it('get no link that RUM says opens nothing, and say why', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tracer, ended } = setup(
      fakeRum({
        getSessionReplayLink: () => `${REPLAY}&error-type=replay-not-started`,
      }),
      { debug: true },
    );
    failed(tracer);
    expect(ended[0]?.attributes['session.replay.url']).toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toContain('has not started recording');
  });

  it('survive a RUM that has not started or throws', () => {
    const boom = () => {
      throw new Error('rum');
    };
    const { tracer, ended } = setup({
      getInternalContext: () => undefined,
      getUser: boom,
      getSessionReplayLink: boom,
    });
    failed(tracer);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.attributes['session.id']).toBeUndefined();
  });
});
