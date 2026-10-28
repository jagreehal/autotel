// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { clearBaggage, getBaggageHeader } from './baggage';
import {
  currentSpanContext,
  enrichSpans,
  liveSpanCountForTesting,
  rememberRequestSpan,
  resetJoinForTesting,
  spanContextOf,
  type EnrichSpansOptions,
} from './join';
import type { SpanContext } from '@opentelemetry/api';

/**
 * No context manager is registered, so `context.active()` is always root: the
 * same thing the browser hands back after the first `await`.
 */
function tracerWith(...processors: SpanProcessor[]) {
  const ended: ReadableSpan[] = [];
  const recorder: SpanProcessor = {
    onStart() {},
    onEnd: (span) => ended.push(span),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
  const provider = new BasicTracerProvider({
    spanProcessors: [...processors, recorder],
  });
  return { tracer: provider.getTracer('test'), ended };
}

function join(options: Partial<EnrichSpansOptions> = {}) {
  return enrichSpans({ name: 'vendor', debug: false, ...options });
}

afterEach(() => {
  resetJoinForTesting();
  clearBaggage();
  vi.restoreAllMocks();
});

describe('currentSpanContext', () => {
  it('recovers the span in flight after the active context is lost', () => {
    const { tracer } = tracerWith(join());
    const span = tracer.startSpan('checkout');

    expect(currentSpanContext()?.spanId).toBe(span.spanContext().spanId);
    span.end();
    expect(currentSpanContext()).toBeUndefined();
  });

  it('keeps the outer span when an inner one ends first', () => {
    const { tracer } = tracerWith(join());
    const outer = tracer.startSpan('outer');
    const inner = tracer.startSpan('inner');
    inner.end();
    expect(currentSpanContext()?.spanId).toBe(outer.spanContext().spanId);
  });

  it('refuses to guess when two traces are in flight', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tracer } = tracerWith(join());
    tracer.startSpan('first click');
    tracer.startSpan('second click');

    expect(currentSpanContext({ debug: true, hint: 'Use X.' })).toBeUndefined();
    expect(currentSpanContext({ debug: true, hint: 'Use X.' })).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('Use X.');
  });

  it('counts a span once however many joins are composed', () => {
    const { tracer } = tracerWith(join({ name: 'a' }), join({ name: 'b' }));
    const span = tracer.startSpan('x');
    expect(liveSpanCountForTesting()).toBe(1);
    span.end();
    expect(liveSpanCountForTesting()).toBe(0);
  });

  it('forgets the oldest spans past the bound', () => {
    const { tracer } = tracerWith(join());
    for (let index = 0; index < 500; index++) tracer.startSpan(`leak ${index}`);
    expect(liveSpanCountForTesting()).toBe(128);
  });
});

describe('enrichSpans', () => {
  it('assigns session.id and fills the rest', () => {
    const { tracer, ended } = tracerWith(
      join({
        session: () => 'vendor-session',
        onStart: () => ({ 'user.id': 'u1', 'app.flag': 'on' }),
      }),
    );
    const span = tracer.startSpan('x', {
      attributes: { 'session.id': 'minted', 'user.id': 'explicit' },
    });
    span.end();

    expect(ended[0]?.attributes).toMatchObject({
      'session.id': 'vendor-session',
      'user.id': 'explicit',
      'app.flag': 'on',
    });
  });

  it('treats an empty session id as absent', () => {
    const { tracer, ended } = tracerWith(join({ session: () => '' }));
    tracer.startSpan('x').end();
    expect(ended[0]?.attributes['session.id']).toBeUndefined();
  });

  it('adds failure attributes only to failed spans', () => {
    const onFailure = () => ({ 'session.replay.url': 'https://replay/1' });
    const { tracer, ended } = tracerWith(join({ onFailure }));

    tracer.startSpan('ok').end();
    const bad = tracer.startSpan('bad');
    bad.setStatus({ code: SpanStatusCode.ERROR });
    bad.end();
    const threw = tracer.startSpan('threw');
    threw.recordException(new Error('boom'));
    threw.end();

    const replay = (name: string) =>
      ended.find((s) => s.name === name)?.attributes['session.replay.url'];
    expect(replay('ok')).toBeUndefined();
    expect(replay('bad')).toBe('https://replay/1');
    expect(replay('threw')).toBe('https://replay/1');
  });

  it('withholds the link when the session rotated mid-span', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let session = 's1';
    const { tracer, ended } = tracerWith(
      join({
        debug: true,
        session: () => session,
        onFailure: () => ({
          'session.replay.url': `https://replay/${session}`,
        }),
      }),
    );
    const span = tracer.startSpan('x');
    session = 's2';
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();

    expect(ended[0]?.attributes['session.replay.url']).toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toContain('[autotel-web:vendor]');
  });

  it('explains a reason string once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tracer } = tracerWith(
      join({ debug: true, onFailure: () => 'replay is not recording.' }),
    );
    for (let index = 0; index < 3; index++) {
      const span = tracer.startSpan('x');
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('replay is not recording.');
  });

  it('survives a vendor that throws', () => {
    const boom = (): never => {
      throw new Error('vendor down');
    };
    const { tracer, ended } = tracerWith(
      join({
        session: boom,
        onStart: boom,
        onFailure: boom,
      }),
    );
    const span = tracer.startSpan('x');
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    expect(ended).toHaveLength(1);
  });

  it('propagates the session as baggage before the first span', () => {
    join({ session: () => 'sess-1' });
    expect(getBaggageHeader()).toContain('session.id=sess-1');
  });

  it('lets the first join own session.id when several recorders compose', () => {
    // RUM and PostHog on one page: one session.id, one baggage header, and
    // the other recorder's session still on the span under its own name.
    const rum = join({ name: 'datadog', session: () => 'rum-1' });
    const posthog = join({ name: 'posthog', session: () => 'ph-1' });
    const { tracer, ended } = tracerWith(posthog, rum);
    tracer.startSpan('x').end();

    expect(ended[0]?.attributes).toMatchObject({
      'session.id': 'rum-1',
      'posthog.session.id': 'ph-1',
    });
    expect(getBaggageHeader()).toBe('session.id=rum-1');
  });

  it('keeps ownership when a framework re-creates the owning join', () => {
    join({ name: 'datadog', session: () => 'rum-1' });
    join({ name: 'posthog', session: () => 'ph-1' });
    const again = join({ name: 'datadog', session: () => 'rum-1' });
    const { tracer, ended } = tracerWith(again);
    tracer.startSpan('x').end();
    expect(ended[0]?.attributes['session.id']).toBe('rum-1');
  });

  it('leaves baggage alone when told to', () => {
    join({ session: () => 'sess-1', propagateSession: false });
    expect(getBaggageHeader() ?? '').not.toContain('session.id');
  });
});

describe('spanContextOf', () => {
  const requestSpan: SpanContext = {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    traceFlags: 1,
  };

  it('finds the request behind the error shapes HTTP clients throw', () => {
    const xhr = {};
    const response = {};
    rememberRequestSpan(xhr, requestSpan);
    rememberRequestSpan(response, requestSpan);

    // axios: error.request is the XHR, error.response.request too
    expect(spanContextOf({ request: xhr })).toBe(requestSpan);
    expect(spanContextOf({ response: { request: xhr } })).toBe(requestSpan);
    // ky / ofetch: error.response is the Response
    expect(spanContextOf({ response })).toBe(requestSpan);
    // new Error(message, { cause: response })
    expect(spanContextOf(new Error('x', { cause: response }))).toBe(
      requestSpan,
    );
  });

  it('answers nothing for an error from no traced request', () => {
    expect(spanContextOf(new Error('x'))).toBeUndefined();
    expect(spanContextOf('x')).toBeUndefined();
    expect(spanContextOf(null)).toBeUndefined();
  });

  it('survives cycles and getters that throw', () => {
    interface Cyclic {
      cause?: Cyclic;
    }
    const cyclic: Cyclic = {};
    cyclic.cause = cyclic;
    const hostile = Object.defineProperty({}, 'request', {
      get() {
        throw new Error('no');
      },
    });
    expect(spanContextOf(cyclic)).toBeUndefined();
    expect(spanContextOf(hostile)).toBeUndefined();
  });

  it('takes a completed request off the spans in flight', () => {
    // The XHR instrumentation ends its span ~300ms after the response; two
    // answered requests in that window must not make an error ambiguous.
    const { tracer } = tracerWith(join());
    const first = tracer.startSpan('GET /orders');
    const second = tracer.startSpan('POST /checkout');
    rememberRequestSpan({}, first.spanContext());
    rememberRequestSpan({}, second.spanContext());
    expect(liveSpanCountForTesting()).toBe(0);
  });

  it('outranks the spans in flight in currentSpanContext', () => {
    const xhr = {};
    rememberRequestSpan(xhr, requestSpan);
    const { tracer } = tracerWith(join());
    tracer.startSpan('something else in flight');
    expect(currentSpanContext({ error: { request: xhr } })).toBe(requestSpan);
  });
});
