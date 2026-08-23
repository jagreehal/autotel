import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { context, trace as otelTrace } from '@opentelemetry/api';
import type { AttributeValue, Attributes } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { BeforeSendFn } from 'posthog-js';
import { setBaggage } from 'autotel-web/baggage';
import { joinPostHog } from './join';

vi.mock('autotel-web/baggage', () => ({
  setBaggage: vi.fn(),
}));

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
});

afterEach(() => {
  vi.mocked(setBaggage).mockClear();
});

// PostHog's own hook type, so the double cannot drift from what before_send
// actually accepts.
type Hook = BeforeSendFn;

/** A PostHog double with the mutable config `set_config` writes through. */
function fakePostHog(before_send?: Hook | Hook[]) {
  const instance = {
    config: { before_send } as { before_send?: Hook | Hook[] },
    // Loosely typed on purpose: PostHog's own `set_config` takes the whole
    // config object, and this double only cares about the one key.
    set_config(patch: Record<string, unknown>) {
      Object.assign(instance.config, patch);
    },
    get_session_id: () => 'sess_1',
    get_distinct_id: () => 'usr_1',
    get_session_replay_url: () => 'https://eu.posthog.com/replay/sess_1?t=3',
    sessionRecordingStarted: () => true,
  };
  return instance;
}

const hooks = (p: ReturnType<typeof fakePostHog>): Hook[] => {
  const value = p.config.before_send;
  return Array.isArray(value) ? value : value ? [value] : [];
};

describe('joinPostHog', () => {
  it('wires the PostHog side without being told twice', () => {
    const posthog = fakePostHog();

    joinPostHog(posthog);

    expect(hooks(posthog)).toHaveLength(1);
  });

  it('returns the enricher, so one call covers both directions', () => {
    const posthog = fakePostHog();

    const enricher = joinPostHog(posthog);
    const attributes: Attributes = {};
    const span = {
      name: 'GET /',
      attributes,
      setAttribute: (k: string, v: AttributeValue) => {
        attributes[k] = v;
      },
      events: [],
      status: { code: 0 },
    } as unknown as ReadableSpan;
    enricher.onStart(span as never, undefined as never);

    expect(span.attributes['session.id']).toBe('sess_1');
  });

  it('keeps hooks the app already registered', () => {
    // before_send is a chain the page may already be using to redact or drop
    // events. Replacing it would silently switch that off.
    const existing: Hook = (e) => e;
    const posthog = fakePostHog([existing]);

    joinPostHog(posthog);

    expect(hooks(posthog)).toHaveLength(2);
    expect(hooks(posthog)[0]).toBe(existing);
  });

  it('accepts a single hook that was not in an array', () => {
    const existing: Hook = (e) => e;
    const posthog = fakePostHog(existing);

    joinPostHog(posthog);

    expect(hooks(posthog)).toEqual([existing, expect.any(Function)]);
  });

  it('does not stack up on repeated calls', () => {
    // Framework code runs twice: React strict mode, HMR, a re-render. Adding
    // the hook again each time would stamp the same properties repeatedly and
    // grow the chain without bound.
    const posthog = fakePostHog();

    joinPostHog(posthog);
    joinPostHog(posthog);
    joinPostHog(posthog);

    expect(hooks(posthog)).toHaveLength(1);
  });

  it('still returns a working enricher when PostHog cannot be configured', () => {
    // The loader stub has no set_config. The trace side must still work.
    const stub = { get_session_id: () => 'sess_1' };

    const enricher = joinPostHog(stub);
    const attributes: Attributes = {};
    const span = {
      name: 'GET /',
      attributes,
      setAttribute: (k: string, v: AttributeValue) => {
        attributes[k] = v;
      },
      events: [],
      status: { code: 0 },
    } as unknown as ReadableSpan;

    expect(() =>
      enricher.onStart(span as never, undefined as never),
    ).not.toThrow();
    expect(span.attributes['session.id']).toBe('sess_1');
  });
});

describe('the loader snippet', () => {
  // The snippet leaves an array on `window.posthog` that queues calls, then
  // posthog-js *replaces* that array with the real instance once it loads.
  // Anything holding the array from before is holding a corpse.
  const snippetStub = () => [] as unknown as ReturnType<typeof fakePostHog>;

  const startSpan = (enricher: ReturnType<typeof joinPostHog>) => {
    const attributes: Attributes = {};
    enricher.onStart(
      {
        attributes,
        setAttribute: (k: string, v: AttributeValue) => {
          attributes[k] = v;
        },
      } as never,
      undefined as never,
    );
    return attributes;
  };

  afterEach(() => {
    delete globalThis.posthog;
  });

  it('finds the real library after the snippet swaps it in', () => {
    const stub = snippetStub();
    globalThis.posthog = stub;
    const enricher = joinPostHog(stub);

    globalThis.posthog = {
      get_session_id: () => 'live-session',
    };

    expect(startSpan(enricher)['session.id']).toBe('live-session');
  });

  it('wires before_send once PostHog can accept it', () => {
    // The stub has no set_config, so the PostHog half cannot be wired at call
    // time. Giving up permanently would leave every PostHog event without its
    // trace for the life of the page.
    const stub = snippetStub();
    globalThis.posthog = stub;
    const enricher = joinPostHog(stub);

    const real = fakePostHog();
    globalThis.posthog = real;
    startSpan(enricher);

    expect(hooks(real)).toHaveLength(1);
  });

  it('prefers an instance passed in over whatever is global', () => {
    // Two PostHog instances on one page is a real setup; an explicit argument
    // is a decision and must not be second-guessed.
    const explicit = fakePostHog();
    globalThis.posthog = {
      get_session_id: () => 'the-other-one',
    };

    expect(startSpan(joinPostHog(explicit))['session.id']).toBe('sess_1');
  });
});

function startSpan(enricher: ReturnType<typeof joinPostHog>): Attributes {
  const attributes: Attributes = {};
  enricher.onStart(
    {
      attributes,
      setAttribute: (k: string, v: AttributeValue) => {
        attributes[k] = v;
      },
    } as never,
    undefined as never,
  );
  return attributes;
}

describe('session baggage', () => {
  it('stamps an event captured after the browser lost the active context', () => {
    // The browser has no AsyncLocalStorage, so `context.active()` is empty
    // again after the first `await`. That is where analytics events actually
    // happen — the fetch came back, the card was declined — and without a
    // fallback every one of them ships with no trace on it.
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const span = provider.getTracer('test').startSpan('checkout.click');

    const event = hooks(posthog)[0]!({
      uuid: 'e1',
      event: 'checkout_failed',
      properties: {},
    });

    expect(event?.properties['$trace_id']).toBe(span.spanContext().traceId);
    expect(event?.properties['$span_id']).toBe(span.spanContext().spanId);
    span.end();
  });

  it('prefers the active context over the fallback', () => {
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const tracer = provider.getTracer('test');
    const stale = tracer.startSpan('earlier.work');
    const active = tracer.startSpan('the.one.we.are.in');

    const event = context.with(
      otelTrace.setSpan(context.active(), active),
      () =>
        hooks(posthog)[0]!({ uuid: 'e1', event: 'clicked', properties: {} }),
    );

    expect(event?.properties['$span_id']).toBe(active.spanContext().spanId);
    stale.end();
    active.end();
  });

  it('adds nothing once every span has ended', () => {
    // A finished span is not where the user is. Stamping it would point the
    // reader at an operation that was already over when the event happened.
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const span = provider.getTracer('test').startSpan('checkout.click');
    span.end();

    const event = hooks(posthog)[0]!({
      uuid: 'e1',
      event: 'checkout_failed',
      properties: {},
    });

    expect(event?.properties['$trace_id']).toBeUndefined();
  });

  it('keeps the outer span while an inner one ends', () => {
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const tracer = provider.getTracer('test');
    const outer = tracer.startSpan('checkout.click');
    const inner = tracer.startSpan('GET /prices');
    inner.end();

    const event = hooks(posthog)[0]!({
      uuid: 'e1',
      event: 'checkout_failed',
      properties: {},
    });

    expect(event?.properties['$span_id']).toBe(outer.spanContext().spanId);
    outer.end();
  });

  it('adds nothing when two traces are in flight at once', () => {
    // Two user actions started while neither is the active context. Each
    // `span()` with no parent starts its own trace, so guessing "the most
    // recent" here is not a wrong span — it is a wrong trace, and a reader
    // following it lands in an unrelated request. Nothing beats wrong.
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const tracer = provider.getTracer('test');
    const first = tracer.startSpan('checkout.click');
    const second = tracer.startSpan('newsletter.signup');
    expect(first.spanContext().traceId).not.toBe(second.spanContext().traceId);

    const event = hooks(posthog)[0]!({
      uuid: 'e1',
      event: 'checkout_failed',
      properties: {},
    });

    expect(event?.properties['$trace_id']).toBeUndefined();
    expect(event?.properties['$span_id']).toBeUndefined();
    first.end();
    second.end();
  });

  it('still answers once the other trace has finished', () => {
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const tracer = provider.getTracer('test');
    const mine = tracer.startSpan('checkout.click');
    const other = tracer.startSpan('newsletter.signup');
    other.end();

    const event = hooks(posthog)[0]!({
      uuid: 'e1',
      event: 'checkout_failed',
      properties: {},
    });

    expect(event?.properties['$trace_id']).toBe(mine.spanContext().traceId);
    mine.end();
  });

  it('does not grow without bound when spans never end', () => {
    // A single-page app that navigates away mid-span, or any span whose end
    // never runs, would otherwise pin every span it ever started in memory for
    // the life of the page.
    const posthog = fakePostHog();
    const join = joinPostHog(posthog);
    const provider = new BasicTracerProvider({ spanProcessors: [join] });
    const tracer = provider.getTracer('test');

    for (let index = 0; index < 5000; index += 1) {
      tracer.startSpan(`never.ends.${index}`);
    }

    // SAFETY: reaching into the processor's own bookkeeping is the only way to
    // observe retention; there is no public surface that reports it.
    const retained = (join as unknown as { liveCount: () => number }).liveCount;
    expect(retained()).toBeLessThanOrEqual(128);
  });

  it('seeds the session before anything has been traced', () => {
    // The wrapped fetch checks for baggage *before* handing off to the
    // instrumented fetch that opens the span — so waiting for a span to start
    // means the first request of the page leaves without `session.id`, and
    // only later ones carry it. With `captureNavigation: false` and no
    // application span around the call, that is every first request.
    joinPostHog(fakePostHog());

    expect(setBaggage).toHaveBeenCalledWith({ 'session.id': 'sess_1' });
  });

  it('waits for PostHog when it is not on the page yet', () => {
    // The loader snippet leaves a stub that cannot answer. Seeding has to be
    // an attempt, not a requirement, or construction order decides whether the
    // join works at all.
    joinPostHog({});

    expect(setBaggage).not.toHaveBeenCalled();
  });

  it('does not seed when propagateSession is off', () => {
    joinPostHog(fakePostHog(), { propagateSession: false });

    expect(setBaggage).not.toHaveBeenCalled();
  });

  it('writes PostHog session.id on the first span', () => {
    const enricher = joinPostHog(fakePostHog());
    startSpan(enricher);

    expect(setBaggage).toHaveBeenCalledTimes(1);
    expect(setBaggage).toHaveBeenCalledWith({ 'session.id': 'sess_1' });
  });

  it('does not rewrite the same session id', () => {
    const enricher = joinPostHog(fakePostHog());
    startSpan(enricher);
    startSpan(enricher);
    startSpan(enricher);

    expect(setBaggage).toHaveBeenCalledTimes(1);
  });

  it('writes again after the session rotates', () => {
    let current = 'sess_early';
    const posthog = fakePostHog();
    posthog.get_session_id = () => current;
    const enricher = joinPostHog(posthog);

    startSpan(enricher);
    current = 'sess_late';
    startSpan(enricher);

    expect(setBaggage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(setBaggage).mock.calls[1]?.[0]).toEqual({
      'session.id': 'sess_late',
    });
  });

  it('skips when propagateSession is false', () => {
    const enricher = joinPostHog(fakePostHog(), { propagateSession: false });
    startSpan(enricher);

    expect(setBaggage).not.toHaveBeenCalled();
  });

  it('skips an empty session id', () => {
    const posthog = fakePostHog();
    posthog.get_session_id = () => '';
    const enricher = joinPostHog(posthog);
    startSpan(enricher);

    expect(setBaggage).not.toHaveBeenCalled();
  });
});
