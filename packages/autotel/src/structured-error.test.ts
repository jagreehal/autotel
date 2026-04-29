import { describe, expect, it, vi } from 'vitest';
import type { Span, SpanContext } from '@opentelemetry/api';
import {
  createStructuredError,
  getStructuredErrorAttributes,
  recordStructuredError,
} from './structured-error';
import { createTraceContext, type TraceContext } from './trace-context';

function createFakeSpan(): {
  span: Span;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  setAttributes: ReturnType<typeof vi.fn>;
} {
  const recordException = vi.fn();
  const setStatus = vi.fn();
  const setAttributes = vi.fn();
  const spanContext: SpanContext = {
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    traceFlags: 1,
  };
  const span = {
    spanContext: () => spanContext,
    setAttribute: vi.fn(),
    setAttributes,
    setStatus,
    recordException,
    addEvent: vi.fn(),
    addLink: vi.fn(),
    addLinks: vi.fn(),
    updateName: vi.fn(),
    isRecording: () => true,
    end: vi.fn(),
  } as unknown as Span;
  return { span, recordException, setStatus, setAttributes };
}

describe('structured-error helpers', () => {
  it('creates an error with structured diagnostic fields', () => {
    const err = createStructuredError({
      message: 'Payment failed',
      why: 'Card declined by issuer',
      fix: 'Use a different card',
      link: 'https://docs.example.com/errors/card-declined',
      code: 'PAYMENT_DECLINED',
      status: 402,
      details: { retryable: false, provider: 'stripe' },
    });

    expect(err.message).toBe('Payment failed');
    expect(err.why).toBe('Card declined by issuer');
    expect(err.fix).toBe('Use a different card');
    expect(err.link).toBe('https://docs.example.com/errors/card-declined');
    expect(err.code).toBe('PAYMENT_DECLINED');
    expect(err.status).toBe(402);
    expect(err.details).toEqual({ retryable: false, provider: 'stripe' });
  });

  it('toString() renders a human-readable diagnostic summary', () => {
    const err = createStructuredError({
      message: 'Payment failed',
      why: 'Card declined by issuer',
      fix: 'Use a different card',
      link: 'https://docs.example.com/errors/card-declined',
      code: 'PAYMENT_DECLINED',
      status: 402,
      cause: new Error('upstream timeout'),
    });

    const output = err.toString();
    expect(output).toBe(
      [
        'StructuredError: Payment failed',
        '  Why: Card declined by issuer',
        '  Fix: Use a different card',
        '  Link: https://docs.example.com/errors/card-declined',
        '  Code: PAYMENT_DECLINED',
        '  Status: 402',
        '  Caused by: Error: upstream timeout',
      ].join('\n'),
    );
  });

  it('toString() omits undefined fields', () => {
    const err = createStructuredError({ message: 'Something broke' });
    expect(err.toString()).toBe('StructuredError: Something broke');
  });

  it('extracts canonical attributes for span logging', () => {
    const err = createStructuredError({
      message: 'Export failed',
      why: 'Template not found',
      fix: 'Upload template and retry',
      details: { export: { format: 'pdf' } },
    });

    const attrs = getStructuredErrorAttributes(err);
    expect(attrs).toMatchObject({
      'error.type': 'StructuredError',
      'error.message': 'Export failed',
      'error.why': 'Template not found',
      'error.fix': 'Upload template and retry',
      'error.details.export.format': 'pdf',
    });
  });

  it('records structured error onto trace context', () => {
    const ctx = {
      recordException: vi.fn(),
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
    } as unknown as TraceContext;

    const err = createStructuredError({
      message: 'Checkout failed',
      why: 'Inventory mismatch',
      fix: 'Re-sync inventory and retry',
    });

    recordStructuredError(ctx, err);

    expect(ctx.recordException).toHaveBeenCalledWith(err);
    expect(ctx.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: 'Checkout failed',
    });
    expect(ctx.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'error.message': 'Checkout failed',
        'error.why': 'Inventory mismatch',
        'error.fix': 'Re-sync inventory and retry',
      }),
    );
  });
});

describe('ctx.recordError', () => {
  it('records a structured error onto the underlying span', () => {
    const { span, recordException, setStatus, setAttributes } =
      createFakeSpan();
    const ctx = createTraceContext(span);
    const err = createStructuredError({
      message: 'Order failed',
      why: 'Inventory unavailable',
      fix: 'Retry after restock',
    });

    ctx.recordError(err);

    expect(recordException).toHaveBeenCalledWith(err);
    expect(setStatus).toHaveBeenCalledWith({ code: 2, message: 'Order failed' });
    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'error.message': 'Order failed',
        'error.why': 'Inventory unavailable',
        'error.fix': 'Retry after restock',
      }),
    );
  });

  it('coerces non-Error values to Error so it is safe in catch blocks', () => {
    const { span, recordException, setStatus, setAttributes } =
      createFakeSpan();
    const ctx = createTraceContext(span);

    ctx.recordError('boom');

    expect(recordException).toHaveBeenCalledTimes(1);
    const recorded = recordException.mock.calls[0][0];
    expect(recorded).toBeInstanceOf(Error);
    expect(recorded.message).toBe('boom');
    expect(setStatus).toHaveBeenCalledWith({ code: 2, message: 'boom' });
    expect(setAttributes).toHaveBeenCalled();
  });
});

describe('ctx.track', () => {
  it('exposes track on the trace context as the ergonomic replacement for ctx.addEvent', () => {
    const { span } = createFakeSpan();
    const ctx = createTraceContext(span);

    expect(typeof ctx.track).toBe('function');
    // Smoke test — should not throw without init() (track is a no-op when no queue is configured)
    expect(() => ctx.track('test.event', { foo: 'bar' })).not.toThrow();
  });
});
