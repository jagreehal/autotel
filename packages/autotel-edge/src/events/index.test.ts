import { describe, expect, it, vi } from 'vitest';
import { context as otelContext, trace } from '@opentelemetry/api';
import { createEdgeSubscribers, getEdgeSubscribers } from './index';
import { getActiveConfig, parseConfig, setConfig } from '../core/config';

describe('createEdgeSubscribers', () => {
  it('dispatches events with service name and attributes', () => {
    const transport = vi.fn();
    const Subscribers = createEdgeSubscribers({
      service: 'edge-service',
      transport,
      includeTraceContext: false,
    });

    Subscribers.trackEvent('user.signup', { plan: 'pro' });

    expect(transport).toHaveBeenCalledTimes(1);
    const event = transport.mock.calls[0][0];
    expect(event.type).toBe('event');
    expect(event.event).toBe('user.signup');
    expect(event.service).toBe('edge-service');
    expect(event.attributes).toEqual({ plan: 'pro' });
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it('passes promise to waitUntil when delivery is fire-and-forget', async () => {
    const waitUntil = vi.fn();
    const Subscribers = createEdgeSubscribers({
      service: 'edge',
      transport: () => Promise.resolve(),
      waitUntil,
    });

    Subscribers.trackEvent('user.signup');

    expect(waitUntil).toHaveBeenCalledTimes(1);
    const promise = waitUntil.mock.calls[0][0];
    await promise;
  });

  it('returns promise when delivery is await', async () => {
    const Subscribers = createEdgeSubscribers({
      service: 'edge',
      transport: () => Promise.resolve(),
      delivery: 'await',
    });

    const result = Subscribers.trackEvent('user.signup');

    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('logs trace context when span is active', () => {
    const transport = vi.fn();
    const Subscribers = createEdgeSubscribers({
      service: 'edge',
      transport,
    });

    const tracer = trace.getTracer('edge-test');
    tracer.startActiveSpan('test-span', (span) => {
      Subscribers.trackEvent('user.signup');
      span.end();
    });

    const event = transport.mock.calls[0][0];
    expect(event.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(event.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(event.correlationId).toBe(event.traceId?.slice(0, 16));
  });

  it('uses active config service name when available', () => {
    const transport = vi.fn();
    const Subscribers = createEdgeSubscribers({
      transport,
      includeTraceContext: false,
    });

    const resolved = parseConfig({
      service: { name: 'from-config' },
      spanProcessors: [],
    });
    const configContext = setConfig(resolved);

    otelContext.with(configContext, () => {
      Subscribers.trackEvent('user.signup');
    });

    const event = transport.mock.calls[0][0];
    expect(event.service).toBe('from-config');
    expect(getActiveConfig()).toBeNull();
  });

  it('invokes onError handler for rejected transports in fire-and-forget mode', async () => {
    const waitUntil = vi.fn((promise: Promise<void>) => {
      void promise;
    });
    const onError = vi.fn();
    const Subscribers = createEdgeSubscribers({
      service: 'edge',
      transport: () => Promise.reject(new Error('boom')),
      waitUntil,
      onError,
    });

    Subscribers.trackEvent('user.signup');

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  it('supports binding waitUntil for reuse', async () => {
    const waitUntil = vi.fn((promise: Promise<void>) => {
      void promise;
    });
    const transport = vi.fn(() => Promise.resolve());
    const Subscribers = createEdgeSubscribers({
      service: 'edge',
      transport,
    });

    const bound = Subscribers.bind({ waitUntil });
    bound.trackEvent('user.signup');

    expect(waitUntil).toHaveBeenCalledTimes(1);
    const promise = waitUntil.mock.calls[0][0];
    await promise;
  });

  it('merges multiple bindings', async () => {
    const waitUntil = vi.fn((promise: Promise<void>) => {
      void promise;
    });
    const transport = vi.fn(() => Promise.resolve());
    const Subscribers = createEdgeSubscribers({
      service: 'edge',
      transport,
    });

    const bound = Subscribers.bind({ waitUntil }).bind({ delivery: 'await' });
    const result = bound.trackEvent('user.signup');

    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});

describe('getEdgeSubscribers', () => {
  it('returns null when subscribers are not configured', () => {
    const resolved = parseConfig({
      service: { name: 'test' },
      spanProcessors: [],
    });
    const configContext = setConfig(resolved);

    otelContext.with(configContext, () => {
      const Subscribers = getEdgeSubscribers();
      expect(Subscribers).toBeNull();
    });
  });

  it('creates Subscribers instance from config subscribers', () => {
    const transport1 = vi.fn();
    const transport2 = vi.fn();
    const resolved = parseConfig({
      service: { name: 'test' },
      spanProcessors: [],
      subscribers: [transport1, transport2],
    });
    const configContext = setConfig(resolved);

    otelContext.with(configContext, () => {
      const Subscribers = getEdgeSubscribers();
      expect(Subscribers).not.toBeNull();
      Subscribers!.trackEvent('user.signup', { plan: 'pro' });

      expect(transport1).toHaveBeenCalledTimes(1);
      expect(transport2).toHaveBeenCalledTimes(1);
      const event = transport1.mock.calls[0][0];
      expect(event.type).toBe('event');
      expect(event.event).toBe('user.signup');
      expect(event.service).toBe('test');
    });
  });

  it('binds waitUntil from ExecutionContext', async () => {
    const waitUntil = vi.fn((promise: Promise<void>) => {
      void promise;
    });
    const transport = vi.fn(() => Promise.resolve());
    const resolved = parseConfig({
      service: { name: 'test' },
      spanProcessors: [],
      subscribers: [transport],
    });
    const configContext = setConfig(resolved);

    const mockCtx = { waitUntil } as ExecutionContext;

    await otelContext.with(configContext, async () => {
      const Subscribers = getEdgeSubscribers(mockCtx);
      expect(Subscribers).not.toBeNull();
      Subscribers!.trackEvent('user.signup');

      expect(waitUntil).toHaveBeenCalledTimes(1);
      const promise = waitUntil.mock.calls[0][0];
      await promise;
    });
  });

  it('logs subscriber errors without interrupting other subscribers', async () => {
    const successAdapter = vi.fn(() => Promise.resolve());
    const failingAdapter = vi.fn(() => Promise.reject(new Error('boom')));
    const resolved = parseConfig({
      service: { name: 'test' },
      spanProcessors: [],
      subscribers: [successAdapter, failingAdapter],
    });
    const configContext = setConfig(resolved);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await otelContext.with(configContext, async () => {
      const Subscribers = getEdgeSubscribers();
      expect(Subscribers).not.toBeNull();
      await Subscribers!.trackEvent('user.signup', undefined, { delivery: 'await' });
    });

    expect(successAdapter).toHaveBeenCalledTimes(1);
    expect(failingAdapter).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[autotel-edge] Subscribers subscriber failed',
      expect.any(Error),
      expect.objectContaining({ subscriberIndex: expect.any(Number), eventType: 'event' }),
    );

    consoleSpy.mockRestore();
  });
});

