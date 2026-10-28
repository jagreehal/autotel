// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { resetJoinForTesting } from 'autotel-web/join';
import {
  joinSentry,
  type JoinSentryOptions,
  type SentryEventLike,
  type SentryLike,
} from './browser';

afterEach(() => {
  resetJoinForTesting();
  vi.restoreAllMocks();
});

function fakeSentry(mode: 'session' | 'buffer' | undefined = 'session') {
  const processors: Array<(e: SentryEventLike) => SentryEventLike> = [];
  let replayId = 'replay-1';
  const sentry: SentryLike & {
    processors: typeof processors;
    rotate(id: string): void;
    integrations: string[];
  } = {
    processors,
    integrations: [],
    rotate: (id) => {
      replayId = id;
    },
    addEventProcessor: (p) => processors.push(p),
    getActiveSpan: () => undefined,
    getIsolationScope: () => ({ getUser: () => ({ id: 'u1' }) }),
    getReplay: () => ({
      getReplayId: () => replayId,
      getRecordingMode: () => mode,
    }),
    getClient: () => ({
      getIntegrationByName: (name) =>
        sentry.integrations.includes(name) ? {} : undefined,
    }),
  };
  return sentry;
}

function setup(sentry: SentryLike, options: JoinSentryOptions = {}) {
  const ended: ReadableSpan[] = [];
  const recorder: SpanProcessor = {
    onStart() {},
    onEnd: (span) => ended.push(span),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
  const tracer = new BasicTracerProvider({
    spanProcessors: [
      joinSentry(sentry, { debug: false, ...options }),
      recorder,
    ],
  }).getTracer('t');
  return { tracer, ended };
}

const sentryEvent = (): SentryEventLike => ({
  contexts: { trace: { trace_id: 'sentry-random', parent_span_id: 'p' } },
});

describe('spans', () => {
  it('carry the Sentry user and the recording replay', () => {
    const { tracer, ended } = setup(fakeSentry());
    tracer.startSpan('x').end();
    expect(ended[0]?.attributes).toMatchObject({
      'user.id': 'u1',
      'sentry.replay_id': 'replay-1',
    });
  });

  it('do not point at a buffered replay that may never be kept', () => {
    const { tracer, ended } = setup(fakeSentry('buffer'));
    tracer.startSpan('x').end();
    expect(ended[0]?.attributes['sentry.replay_id']).toBeUndefined();
  });

  it('get a replay link only when they failed', () => {
    const { tracer, ended } = setup(fakeSentry(), {
      replayUrl: (id) => `https://org.sentry.io/replays/${id}/`,
    });
    tracer.startSpan('ok').end();
    const bad = tracer.startSpan('bad');
    bad.setStatus({ code: SpanStatusCode.ERROR });
    bad.end();
    const url = (name: string) =>
      ended.find((s) => s.name === name)?.attributes['session.replay.url'];
    expect(url('ok')).toBeUndefined();
    expect(url('bad')).toBe('https://org.sentry.io/replays/replay-1/');
  });

  it('get no replay link when the replay changed mid-span', () => {
    const sentry = fakeSentry();
    const { tracer, ended } = setup(sentry, { replayUrl: (id) => id });
    const span = tracer.startSpan('x');
    sentry.rotate('replay-2');
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    expect(ended[0]?.attributes['session.replay.url']).toBeUndefined();
  });

  it('survive an SDK that throws', () => {
    const boom = (): never => {
      throw new Error('sdk');
    };
    const sentry: SentryLike = {
      addEventProcessor: boom,
      getIsolationScope: boom,
      getReplay: boom,
      getClient: boom,
    };
    const { tracer, ended } = setup(sentry, { replayUrl: (id) => id });
    const span = tracer.startSpan('x');
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    expect(ended).toHaveLength(1);
  });
});

describe('Sentry events', () => {
  it('get the trace in flight, without Sentry’s stale parent', () => {
    const sentry = fakeSentry();
    const { tracer } = setup(sentry);
    const span = tracer.startSpan('checkout');
    const event = sentry.processors[0]!(sentryEvent());
    expect(event?.contexts?.trace).toEqual({
      trace_id: span.spanContext().traceId,
      span_id: span.spanContext().spanId,
    });
  });

  it('keep a trace the caller passed, and link it', () => {
    const sentry = fakeSentry();
    sentry.getCurrentScope = () => ({
      getPropagationContext: () => ({ traceId: 'sentry-random' }),
    });
    const { tracer } = setup(sentry, {
      traceUrl: ({ traceId }) => `https://t/${traceId}`,
    });
    tracer.startSpan('another trace in flight');
    const event = sentry.processors[0]!({
      contexts: { trace: { trace_id: 'mine', span_id: 's1' } },
    });
    expect(event?.contexts?.trace).toEqual({ trace_id: 'mine', span_id: 's1' });
    expect(event?.contexts?.autotel).toEqual({ trace_url: 'https://t/mine' });
  });

  it('replace Sentry’s own default trace with the one in flight', () => {
    const sentry = fakeSentry();
    sentry.getCurrentScope = () => ({
      getPropagationContext: () => ({ traceId: 'sentry-random' }),
    });
    const { tracer } = setup(sentry);
    const span = tracer.startSpan('checkout');
    const event = sentry.processors[0]!(sentryEvent());
    expect(event?.contexts?.trace?.trace_id).toBe(span.spanContext().traceId);
  });

  it('are left alone when Sentry has its own active span', () => {
    const sentry = fakeSentry();
    sentry.getActiveSpan = () => ({});
    const { tracer } = setup(sentry);
    tracer.startSpan('checkout');
    expect(
      sentry.processors[0]!(sentryEvent())?.contexts?.trace?.trace_id,
    ).toBe('sentry-random');
  });

  it('are left alone when two traces are in flight', () => {
    const sentry = fakeSentry();
    const { tracer } = setup(sentry);
    tracer.startSpan('a');
    tracer.startSpan('b');
    expect(
      sentry.processors[0]!(sentryEvent())?.contexts?.trace?.trace_id,
    ).toBe('sentry-random');
  });

  it('pass through when the app’s traceUrl throws', () => {
    const sentry = fakeSentry();
    const { tracer } = setup(sentry, {
      traceUrl: () => {
        throw new Error('app');
      },
    });
    const span = tracer.startSpan('x');
    const event = sentry.processors[0]!(sentryEvent());
    expect(event?.contexts?.trace?.trace_id).toBe(span.spanContext().traceId);
  });
});

describe('two tracers', () => {
  it('warns when Sentry’s browser tracing is on too', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sentry = fakeSentry();
    sentry.integrations.push('BrowserTracing');
    const { tracer } = setup(sentry, { debug: true });
    tracer.startSpan('a').end();
    tracer.startSpan('b').end();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('browserTracingIntegration');
  });
});
