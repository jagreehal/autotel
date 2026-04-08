import { describe, expect, it, vi, afterEach } from 'vitest';
import { trace as otelTrace } from '@opentelemetry/api';
import { getExecutionLogger } from './execution-logger';
import type { TraceContext } from './functional';

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
  };
}

describe('getExecutionLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets flattened fields onto the active trace context', () => {
    const ctx = createMockContext();
    const log = getExecutionLogger(ctx);

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

  it('adds warning events and sets a warning level marker', () => {
    const ctx = createMockContext();
    const log = getExecutionLogger(ctx);

    log.warn('slow batch', {
      queue: { name: 'payments' },
      duration_ms: 1350,
    });

    expect(ctx.addEvent).toHaveBeenCalledWith('log.warn', {
      message: 'slow batch',
      'queue.name': 'payments',
      duration_ms: 1350,
    });
    expect(ctx.setAttribute).toHaveBeenCalledWith('autotel.log.level', 'warn');
  });

  it('records exceptions and attaches structured error attributes', () => {
    const ctx = createMockContext();
    const log = getExecutionLogger(ctx);
    const error = Object.assign(new Error('payment processor unavailable'), {
      why: 'Provider timeout',
      fix: 'Retry later',
    });

    log.error(error, {
      step: 'payment',
    });

    expect(ctx.recordException).toHaveBeenCalledWith(error);
    expect(ctx.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: 'payment processor unavailable',
    });
    expect(ctx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'error.message': 'payment processor unavailable',
        'error.why': 'Provider timeout',
        'error.fix': 'Retry later',
      }),
    );
    expect(ctx.addEvent).toHaveBeenCalledWith('log.error', {
      message: 'payment processor unavailable',
      step: 'payment',
    });
  });

  it('returns accumulated context via getContext()', () => {
    const ctx = createMockContext();
    const log = getExecutionLogger(ctx);

    log.set({ provider: { name: 'curvepay' } });
    log.info('chunk read', { chunk: { size: 25 } });

    expect(log.getContext()).toEqual({
      provider: { name: 'curvepay' },
      chunk: { size: 25 },
    });
  });

  it('emitNow records a manual event and returns a snapshot', async () => {
    const ctx = createMockContext();
    const onEmit = vi.fn(async () => {});
    const log = getExecutionLogger(ctx, { onEmit });

    log.set({ providerBatchId: 'pb_123' });
    const snapshot = log.emitNow({ outcome: 'finalized' });

    expect(snapshot).toMatchObject({
      traceId: 'trace-id',
      spanId: 'span-id',
      correlationId: 'corr-id',
      context: {
        providerBatchId: 'pb_123',
        outcome: 'finalized',
      },
      timestamp: expect.any(String),
    });
    expect(ctx.addEvent).toHaveBeenCalledWith(
      'log.emit.manual',
      expect.objectContaining({
        providerBatchId: 'pb_123',
        outcome: 'finalized',
      }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(onEmit).toHaveBeenCalledWith(snapshot);
  });

  it('resolves context from the active span when no ctx is passed', () => {
    const span = {
      spanContext: () => ({
        traceId: 'active-trace-id',
        spanId: 'active-span-id',
        traceFlags: 1,
      }),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      addEvent: vi.fn(),
      addLink: vi.fn(),
      addLinks: vi.fn(),
      updateName: vi.fn(),
      isRecording: vi.fn(() => true),
    };

    vi.spyOn(otelTrace, 'getActiveSpan').mockReturnValue(span as never);

    const log = getExecutionLogger();
    log.set({ workflow: { id: 'wf-123' } });

    expect(span.setAttributes).toHaveBeenCalledWith({
      'workflow.id': 'wf-123',
    });
  });

  it('throws when no trace context is available', () => {
    vi.spyOn(otelTrace, 'getActiveSpan').mockReturnValue(undefined);

    expect(() => getExecutionLogger()).toThrow(
      '[autotel-edge] getExecutionLogger() requires an active span or explicit TraceContext. Wrap your handler with trace() or pass ctx directly.',
    );
  });
});
