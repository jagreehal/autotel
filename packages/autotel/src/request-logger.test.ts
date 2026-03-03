import { describe, expect, it, vi } from 'vitest';
import { getRequestLogger } from './request-logger';
import type { TraceContext } from './trace-context';

function createMockContext(): TraceContext {
  return {
    traceId: 'trace-id',
    spanId: 'span-id',
    correlationId: 'corr-id',
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    addEvent: vi.fn(),
    addLink: vi.fn(),
    addLinks: vi.fn(),
    updateName: vi.fn(),
    isRecording: vi.fn(() => true),
    getBaggage: vi.fn(),
    setBaggage: vi.fn(),
    deleteBaggage: vi.fn(),
    getAllBaggage: vi.fn(() => new Map()),
  } as unknown as TraceContext;
}

describe('getRequestLogger', () => {
  it('sets flattened fields onto active span context', () => {
    const ctx = createMockContext();
    const log = getRequestLogger(ctx);

    log.set({
      user: { id: 'u1', plan: 'pro' },
      attempts: 3,
      success: true,
    });

    expect(ctx.setAttributes).toHaveBeenCalledWith({
      'user.id': 'u1',
      'user.plan': 'pro',
      attempts: 3,
      success: true,
    });
  });

  it('adds warning events and sets warning level marker', () => {
    const ctx = createMockContext();
    const log = getRequestLogger(ctx);

    log.warn('slow request', {
      http: { route: '/checkout' },
      duration_ms: 1350,
    });

    expect(ctx.addEvent).toHaveBeenCalledWith('log.warn', {
      message: 'slow request',
      'http.route': '/checkout',
      duration_ms: 1350,
    });
    expect(ctx.setAttribute).toHaveBeenCalledWith('autotel.log.level', 'warn');
  });

  it('records and annotates errors with structured diagnostics', () => {
    const ctx = createMockContext();
    const log = getRequestLogger(ctx);

    log.error(new Error('payment processor unavailable'), {
      step: 'payment',
    });

    expect(ctx.recordException).toHaveBeenCalled();
    expect(ctx.addEvent).toHaveBeenCalledWith('log.error', {
      message: 'payment processor unavailable',
      step: 'payment',
    });
    expect(ctx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'error.message': 'payment processor unavailable',
      }),
    );
  });

  it('returns accumulated context via getContext()', () => {
    const ctx = createMockContext();
    const log = getRequestLogger(ctx);

    log.set({ user: { id: 'u1' } });
    log.info('step', { checkout: { step: 'payment' } });

    expect(log.getContext()).toEqual({
      user: { id: 'u1' },
      checkout: { step: 'payment' },
    });
  });

  it('emitNow records manual event and returns snapshot', async () => {
    const ctx = createMockContext();
    const onEmit = vi.fn(async () => {});
    const log = getRequestLogger(ctx, { onEmit });

    log.set({ user: { id: 'u1' } });
    const snapshot = log.emitNow({ stage: 'preflight' });

    expect(snapshot).toMatchObject({
      traceId: 'trace-id',
      spanId: 'span-id',
      correlationId: 'corr-id',
      context: {
        user: { id: 'u1' },
        stage: 'preflight',
      },
      timestamp: expect.any(String),
    });
    expect(ctx.addEvent).toHaveBeenCalledWith(
      'log.emit.manual',
      expect.objectContaining({
        'user.id': 'u1',
        stage: 'preflight',
      }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(onEmit).toHaveBeenCalledWith(snapshot);
  });
});
