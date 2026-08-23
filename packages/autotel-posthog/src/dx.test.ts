import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { BeforeSendFn } from 'posthog-js';
import { autotelBeforeSend, traceProperties } from './before-send';
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

const warnings = () =>
  vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  vi.restoreAllMocks();
  process.env.NODE_ENV = originalNodeEnv;
});

describe('traceProperties()', () => {
  it('reads the ids while the span is still active', () => {
    const provider = new BasicTracerProvider();
    const tracer = provider.getTracer('test');

    const [span, properties] = tracer.startActiveSpan(
      'checkout.click',
      (s) => [s, traceProperties()] as const,
    );

    expect(properties['$trace_id']).toBe(span.spanContext().traceId);
    expect(properties['$span_id']).toBe(span.spanContext().spanId);
    span.end();
  });

  it('spreads to nothing when there is no span to read', () => {
    expect(traceProperties()).toEqual({});
  });

  it('still gets a $trace_url when the caller supplied the ids', () => {
    // Explicit ids and recovered ids should produce the same event. Otherwise
    // taking the documented escape hatch silently costs you the clickable link.
    const hook = autotelBeforeSend({
      traceUrl: ({ traceId }) => `https://traces.example.com/${traceId}`,
    });

    const event = hook({
      uuid: 'e1',
      event: 'checkout_failed',
      properties: { $trace_id: 'abc', $span_id: 'def' },
    });

    expect(event?.properties['$trace_url']).toBe(
      'https://traces.example.com/abc',
    );
  });
});

describe('warning by default', () => {
  it('speaks up in development without being asked', () => {
    // Opt-in diagnostics are read by people who already know something is
    // wrong. The whole failure here is not knowing.
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const tracer = provider.getTracer('test');
    const first = tracer.startSpan('checkout.click');
    const second = tracer.startSpan('newsletter.signup');

    hooks(posthog)[0]!({ uuid: 'e1', event: 'clicked', properties: {} });

    expect(warnings().join(' ')).toMatch(/traceProperties/);
    first.end();
    second.end();
  });

  it('stays silent in production', () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const tracer = provider.getTracer('test');
    const first = tracer.startSpan('checkout.click');
    const second = tracer.startSpan('newsletter.signup');

    hooks(posthog)[0]!({ uuid: 'e1', event: 'clicked', properties: {} });

    expect(warnings()).toEqual([]);
    first.end();
    second.end();
  });

  it('takes debug: false as the last word, even in development', () => {
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const posthog = fakePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog, { debug: false })],
    });
    const tracer = provider.getTracer('test');
    const first = tracer.startSpan('checkout.click');
    const second = tracer.startSpan('newsletter.signup');

    hooks(posthog)[0]!({ uuid: 'e1', event: 'clicked', properties: {} });

    expect(warnings()).toEqual([]);
    first.end();
    second.end();
  });
});

afterEach(() => {
  trace.disable();
});
