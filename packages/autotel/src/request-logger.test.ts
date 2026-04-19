import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { trace as otelTrace } from '@opentelemetry/api';
import { getRequestLogger, runWithRequestContext } from './request-logger';
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('post-emit warnings', () => {
  let ctx: TraceContext;
  let log: ReturnType<typeof getRequestLogger>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctx = createMockContext();
    log = getRequestLogger(ctx);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns when set() is called after emitNow()', () => {
    log.emitNow();
    log.set({ dropped: 'value' });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[autotel] log.set() called after the wide event was emitted',
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Keys dropped: dropped'),
    );
  });

  it('warns when info() is called after emitNow()', () => {
    log.emitNow();
    log.info('after emit', { extra: 'data' });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[autotel] log.info() called after the wide event was emitted',
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Keys dropped: message, extra'),
    );
  });

  it('warns when warn() is called after emitNow()', () => {
    log.emitNow();
    log.warn('after emit', { extra: 'data' });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[autotel] log.warn() called after the wide event was emitted',
      ),
    );
  });

  it('warns when error() is called after emitNow()', () => {
    log.emitNow();
    log.error(new Error('after emit'), { step: 'cleanup' });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[autotel] log.error() called after the wide event was emitted',
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Keys dropped: step, error'),
    );
  });

  it('warns on duplicate emitNow()', () => {
    const first = log.emitNow();
    const second = log.emitNow();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[autotel] log.emitNow() called after the wide event was emitted',
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring duplicate emit'),
    );
    expect(second).toBe(first);
  });

  it('does not warn when calls are made before emitNow()', () => {
    log.set({ user: { id: 'u1' } });
    log.info('step', { stage: 'payment' });
    log.warn('slow');
    log.error(new Error('fail'));
    log.emitNow();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('array concatenation in set()', () => {
  let ctx: TraceContext;
  let log: ReturnType<typeof getRequestLogger>;

  beforeEach(() => {
    ctx = createMockContext();
    log = getRequestLogger(ctx);
  });

  it('concatenates arrays when both values are arrays', () => {
    log.set({ tags: ['initial', 'setup'] });
    log.set({ tags: ['payment', 'complete'] });

    expect(log.getContext()).toEqual({
      tags: ['initial', 'setup', 'payment', 'complete'],
    });
  });

  it('replaces array with non-array value', () => {
    log.set({ tags: ['a', 'b'] });
    log.set({ tags: 'single' });

    expect(log.getContext()).toEqual({
      tags: 'single',
    });
  });

  it('replaces non-array with array', () => {
    log.set({ tags: 'single' });
    log.set({ tags: ['a', 'b'] });

    expect(log.getContext()).toEqual({
      tags: ['a', 'b'],
    });
  });

  it('deep merges objects while concatenating nested arrays', () => {
    log.set({
      user: { id: 'u1', roles: ['admin'] },
    });
    log.set({
      user: { name: 'Alice', roles: ['editor'] },
    });

    expect(log.getContext()).toEqual({
      user: {
        id: 'u1',
        name: 'Alice',
        roles: ['admin', 'editor'],
      },
    });
  });
});

describe('log.fork()', () => {
  let ctx: TraceContext;
  let log: ReturnType<typeof getRequestLogger>;

  beforeEach(() => {
    ctx = createMockContext();
    log = getRequestLogger(ctx);
  });

  it('throws when parent has no correlationId', () => {
    const noCorrCtx = createMockContext();
    (noCorrCtx as Record<string, unknown>).correlationId = '';
    const noCorrLog = getRequestLogger(noCorrCtx);

    expect(() => noCorrLog.fork('test', () => {})).toThrow(
      '[autotel] log.fork() requires the parent logger to have a correlationId',
    );
  });

  it('fork method exists on the logger interface', () => {
    expect(typeof log.fork).toBe('function');
  });

  it('uses an isolated child span context for forked work', async () => {
    const childSpan = {
      spanContext: () => ({
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
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
      end: vi.fn(),
    };

    const tracer = {
      startActiveSpan: (
        _name: string,
        cb: (span: typeof childSpan) => void,
      ) => {
        cb(childSpan);
      },
    };

    const tracerSpy = vi
      .spyOn(otelTrace, 'getTracer')
      .mockReturnValue(
        tracer as unknown as ReturnType<typeof otelTrace.getTracer>,
      );

    log.fork('background-work', async () => {
      const childLog = getRequestLogger();
      childLog.info('running child task', { phase: 'upload' });
    });

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(tracerSpy).toHaveBeenCalledWith('autotel.request-logger');
    expect(childSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'background-work',
        _parentCorrelationId: 'corr-id',
      }),
    );
    expect(childSpan.addEvent).toHaveBeenCalledWith(
      'log.emit.manual',
      expect.any(Object),
    );
    expect(ctx.setAttributes).not.toHaveBeenCalled();
    expect(childSpan.end).toHaveBeenCalledTimes(1);
  });
});

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

  it('resolves context from AsyncLocalStorage when no args given', () => {
    const ctx = createMockContext();

    runWithRequestContext(ctx, () => {
      const log = getRequestLogger();
      log.set({ user: { id: 'als-user' } });

      expect(ctx.setAttributes).toHaveBeenCalledWith({
        'user.id': 'als-user',
      });
    });
  });

  it('resolves context from the active OTel span when no args and no ALS context', () => {
    const activeSpan = {
      spanContext: () => ({
        traceId: 'c'.repeat(32),
        spanId: 'd'.repeat(16),
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

    const spanSpy = vi
      .spyOn(otelTrace, 'getActiveSpan')
      .mockReturnValue(
        activeSpan as unknown as ReturnType<typeof otelTrace.getActiveSpan>,
      );

    const log = getRequestLogger();
    log.set({ order: { id: 'o-1' } });

    expect(spanSpy).toHaveBeenCalled();
    expect(activeSpan.setAttributes).toHaveBeenCalledWith({
      'order.id': 'o-1',
    });
  });
});
