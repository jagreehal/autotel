import { beforeAll, describe, expect, it, vi } from 'vitest';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { BeforeSendFn } from 'posthog-js';
import { joinPostHog } from './join';

vi.mock('autotel-web/baggage', () => ({ setBaggage: vi.fn() }));

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
});

function fakePostHog() {
  const instance = {
    config: {
      before_send: undefined as BeforeSendFn | BeforeSendFn[] | undefined,
    },
    set_config(patch: Record<string, unknown>) {
      Object.assign(instance.config, patch);
    },
    get_session_id: () => 'sess_1',
    get_distinct_id: () => 'usr_1',
    get_session_replay_url: () => 'https://us.posthog.com/replay/sess_1',
    sessionRecordingStarted: () => true,
  };
  return instance;
}

const hooks = (p: ReturnType<typeof fakePostHog>): BeforeSendFn[] => {
  const value = p.config.before_send;
  return Array.isArray(value) ? value : value ? [value] : [];
};

describe('joinPostHog called more than once', () => {
  it('does not accumulate state for processors nobody registered', () => {
    // Strict mode, HMR and repeated configuration all call this again. Only
    // the processor the app registers ever sees a span; the rest are garbage.
    // Holding a slot for each of them grows both retained memory and the work
    // every single PostHog capture has to do.
    const posthog = fakePostHog();
    let processor = joinPostHog(posthog);
    for (let index = 0; index < 5000; index += 1) {
      processor = joinPostHog(posthog);
    }

    // SAFETY: the shared registry has no public surface; reading its size is
    // the only way to observe that it is not growing.
    const registered = (
      processor as unknown as { registeredCount: () => number }
    ).registeredCount;
    expect(registered()).toBe(0);
  });

  it('lets go of a processor once its spans have ended', () => {
    const posthog = fakePostHog();
    const first = joinPostHog(posthog);
    const second = joinPostHog(posthog);
    const provider = new BasicTracerProvider({
      spanProcessors: [first, second],
    });

    const span = provider.getTracer('test').startSpan('checkout.click');
    const registered = (second as unknown as { registeredCount: () => number })
      .registeredCount;
    expect(registered()).toBeGreaterThan(0);

    span.end();

    expect(registered()).toBe(0);
  });

  it('recovers the span from whichever processor is registered', () => {
    // Strict mode, HMR and a re-render all call this twice. The hook is
    // installed once on purpose — a chain that grows per render stamps
    // properties repeatedly — but the second call returns the processor the
    // app actually registers. If the installed hook can only see the first
    // call's spans, the join silently stops working after any re-render.
    const posthog = fakePostHog();

    joinPostHog(posthog);
    const second = joinPostHog(posthog);

    expect(hooks(posthog)).toHaveLength(1);

    const provider = new BasicTracerProvider({ spanProcessors: [second] });
    const span = provider.getTracer('test').startSpan('checkout.click');

    const event = hooks(posthog)[0]!({
      uuid: 'e1',
      event: 'checkout_failed',
      properties: {},
    });

    expect(event?.properties['$trace_id']).toBe(span.spanContext().traceId);
    span.end();
  });

  it('still refuses when the registered processors disagree on the trace', () => {
    const posthog = fakePostHog();
    const first = joinPostHog(posthog);
    const second = joinPostHog(posthog);
    const provider = new BasicTracerProvider({
      spanProcessors: [first, second],
    });
    const tracer = provider.getTracer('test');
    const a = tracer.startSpan('checkout.click');
    const b = tracer.startSpan('newsletter.signup');
    expect(a.spanContext().traceId).not.toBe(b.spanContext().traceId);

    const event = hooks(posthog)[0]!({
      uuid: 'e1',
      event: 'clicked',
      properties: {},
    });

    expect(event?.properties['$trace_id']).toBeUndefined();
    a.end();
    b.end();
  });
});
