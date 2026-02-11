import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SentrySpanProcessor, createSentrySpanProcessor } from './processor';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Span } from '@opentelemetry/sdk-trace-base';
import { context } from '@opentelemetry/api';

function createMockReadableSpan(overrides: Partial<{
  name: string;
  spanId: string;
  traceId: string;
  parentSpanId: string;
  attributes: Record<string, unknown>;
  resource: { attributes: Record<string, unknown> };
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  status: { code: number };
  kind: number;
  startTime: [number, number];
  endTime: [number, number];
}> = {}): ReadableSpan {
  return {
    name: 'test-span',
    kind: 0,
    spanContext: () => ({
      traceId: overrides.traceId ?? 'trace123',
      spanId: overrides.spanId ?? 'span456',
      traceFlags: 1,
    }),
    parentSpanContext: overrides.parentSpanId
      ? { traceId: 'trace123', spanId: overrides.parentSpanId, traceFlags: 1 }
      : undefined,
    startTime: overrides.startTime ?? [0, 0],
    endTime: overrides.endTime ?? [1, 0],
    status: { code: overrides.status?.code ?? 1 },
    attributes: overrides.attributes ?? {},
    resource: overrides.resource ?? { attributes: { 'service.name': 'test' } },
    events: overrides.events ?? [],
    links: [],
    duration: [1, 0],
    ended: true,
    instrumentationScope: { name: 'test', version: '1.0' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

function createMockSpan(overrides: Partial<{ name: string; spanId: string; parentSpanId: string }> = {}): Span {
  const spanContext = () => ({
    traceId: 'trace123',
    spanId: overrides.spanId ?? 'span456',
    traceFlags: 1,
  });
  return {
    name: overrides.name ?? 'test-span',
    spanContext,
    parentSpanContext: overrides.parentSpanId
      ? { traceId: 'trace123', spanId: overrides.parentSpanId, traceFlags: 1 }
      : undefined,
    startTime: [0, 0],
  } as unknown as Span;
}

describe('SentrySpanProcessor', () => {
  let mockSentry: {
    getCurrentHub: ReturnType<typeof vi.fn>;
    addGlobalEventProcessor: ReturnType<typeof vi.fn>;
    captureException: ReturnType<typeof vi.fn>;
  };
  let mockHub: {
    startTransaction: ReturnType<typeof vi.fn>;
    getSpan: ReturnType<typeof vi.fn>;
  };
  let mockTransaction: {
    startChild: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    setContext: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
  };
  let mockChildSpan: {
    setStatus: ReturnType<typeof vi.fn>;
    setData: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockTransaction = {
      startChild: vi.fn(),
      setStatus: vi.fn(),
      setContext: vi.fn(),
      finish: vi.fn(),
    };
    mockChildSpan = {
      setStatus: vi.fn(),
      setData: vi.fn(),
      finish: vi.fn(),
    };
    mockHub = {
      startTransaction: vi.fn(() => mockTransaction),
      getSpan: vi.fn(),
    };
    mockSentry = {
      getCurrentHub: vi.fn(() => mockHub),
      addGlobalEventProcessor: vi.fn(),
      captureException: vi.fn(),
    };
  });

  it('registers a global event processor in constructor', () => {
    new SentrySpanProcessor(mockSentry as any);
    expect(mockSentry.addGlobalEventProcessor).toHaveBeenCalledTimes(1);
    expect(typeof mockSentry.addGlobalEventProcessor.mock.calls[0][0]).toBe('function');
  });

  it('onStart creates a transaction when no parent', () => {
    const processor = new SentrySpanProcessor(mockSentry as any);
    const span = createMockSpan({ spanId: 'root' });
    processor.onStart(span, context.active());
    expect(mockHub.startTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test-span',
        traceId: 'trace123',
        spanId: 'root',
        instrumenter: 'otel',
      }),
    );
  });

  it('onStart creates a child span when parent exists in map', () => {
    const processor = new SentrySpanProcessor(mockSentry as any);
    const parentSpan = createMockSpan({ spanId: 'parent' });
    const childSpan = createMockSpan({ spanId: 'child', parentSpanId: 'parent' });
    processor.onStart(parentSpan, context.active());
    mockHub.startTransaction.mockReturnValue(mockTransaction);
    processor.onStart(childSpan, context.active());
    expect(mockTransaction.startChild).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'test-span',
        spanId: 'child',
        instrumenter: 'otel',
      }),
    );
  });

  it('onEnd updates and finishes transaction', () => {
    const processor = new SentrySpanProcessor(mockSentry as any);
    const span = createMockSpan({ spanId: 'root' });
    processor.onStart(span, context.active());
    const readableSpan = createMockReadableSpan({ spanId: 'root', traceId: 'trace123' });
    (readableSpan as any).spanContext = () => ({ traceId: 'trace123', spanId: 'root' });
    processor.onEnd(readableSpan);
    expect(mockTransaction.setStatus).toHaveBeenCalled();
    expect(mockTransaction.setContext).toHaveBeenCalledWith('otel', expect.any(Object));
    expect(mockTransaction.finish).toHaveBeenCalled();
  });

  it('onEnd updates and finishes child span', () => {
    const processor = new SentrySpanProcessor(mockSentry as any);
    const parentSpan = createMockSpan({ spanId: 'parent' });
    const childSpan = createMockSpan({ spanId: 'child', parentSpanId: 'parent' });
    processor.onStart(parentSpan, context.active());
    mockTransaction.startChild.mockReturnValue(mockChildSpan);
    processor.onStart(childSpan, context.active());
    const readableChild = createMockReadableSpan({
      spanId: 'child',
      parentSpanId: 'parent',
    });
    (readableChild as any).spanContext = () => ({ traceId: 'trace123', spanId: 'child' });
    processor.onEnd(readableChild);
    expect(mockChildSpan.setStatus).toHaveBeenCalled();
    expect(mockChildSpan.finish).toHaveBeenCalled();
  });

  it('onEnd skips finishing when span is Sentry request', () => {
    const processor = new SentrySpanProcessor(mockSentry as any);
    const span = createMockSpan({ spanId: 'root' });
    processor.onStart(span, context.active());
    const readableSpan = createMockReadableSpan({
      spanId: 'root',
      attributes: { 'http.url': 'https://sentry.io/api/123/envelope/' },
    });
    (readableSpan as any).spanContext = () => ({ traceId: 'trace123', spanId: 'root' });
    const hubWithDsn = {
      ...mockHub,
      getClient: () => ({ getDsn: () => ({ host: 'sentry.io' }) }),
    };
    mockSentry.getCurrentHub.mockReturnValue(hubWithDsn);
    processor.onEnd(readableSpan);
    expect(mockTransaction.finish).not.toHaveBeenCalled();
  });

  it('createSentrySpanProcessor returns a SentrySpanProcessor instance', () => {
    const processor = createSentrySpanProcessor(mockSentry as any);
    expect(processor).toBeInstanceOf(SentrySpanProcessor);
  });
});
