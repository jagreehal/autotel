import { describe, it, expect, vi } from 'vitest';
import { SentryPropagator, SENTRY_PROPAGATION_KEY } from './propagator';
import { context, trace } from '@opentelemetry/api';

describe('SentryPropagator', () => {
  it('fields returns sentry-trace and baggage', () => {
    const propagator = new SentryPropagator();
    expect(propagator.fields()).toEqual(['sentry-trace', 'baggage']);
  });

  it('inject sets sentry-trace and optionally baggage on carrier', () => {
    const propagator = new SentryPropagator();
    const carrier: Record<string, string> = {};
    const setter = {
      set(c: Record<string, string>, key: string, value: string) {
        c[key] = value;
      },
    };
    const span = {
      spanContext: () => ({
        traceId: 'abc123',
        spanId: 'def456',
        traceFlags: 1,
      }),
    };
    const ctx = trace.setSpan(context.active(), span as any);
    propagator.inject(ctx, carrier, setter as any);
    expect(carrier['sentry-trace']).toBe('abc123-def456-1');
  });

  it('inject does nothing when no span in context', () => {
    const propagator = new SentryPropagator();
    const carrier: Record<string, string> = {};
    const setter = { set: vi.fn() };
    propagator.inject(context.active(), carrier, setter as any);
    expect(setter.set).not.toHaveBeenCalled();
  });

  it('extract stores sentry-trace and baggage in context', () => {
    const propagator = new SentryPropagator();
    const carrier: Record<string, string> = {
      'sentry-trace': 'trace1-span1-1',
      baggage: 'key=value',
    };
    const getter = {
      keys: (c: Record<string, string>) => Object.keys(c),
      get: (c: Record<string, string>, key: string) => c[key],
    };
    const ctx = propagator.extract(context.active(), carrier, getter as any);
    const data = ctx.getValue(SENTRY_PROPAGATION_KEY);
    expect(data).toEqual({
      sentryTrace: 'trace1-span1-1',
      baggage: 'key=value',
    });
  });

  it('extract returns same context when no sentry headers', () => {
    const propagator = new SentryPropagator();
    const carrier: Record<string, string> = {};
    const getter = {
      keys: () => [],
      get: () => undefined,
    };
    const base = context.active();
    const ctx = propagator.extract(base, carrier, getter as any);
    expect(ctx.getValue(SENTRY_PROPAGATION_KEY)).toBeUndefined();
  });
});
