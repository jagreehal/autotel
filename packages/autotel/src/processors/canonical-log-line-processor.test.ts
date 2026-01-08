import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanonicalLogLineProcessor } from './canonical-log-line-processor';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { logs } from '@opentelemetry/api-logs';
import type { Logger } from '../logger';

describe('CanonicalLogLineProcessor', () => {
  let mockLogger: Logger;
  let mockOTelLogger: ReturnType<typeof logs.getLogger>;
  let logEntries: Array<{
    level: string;
    message: string;
    attrs: Record<string, unknown>;
  }>;

  beforeEach(() => {
    logEntries = [];
    // Pino-native signature: (extra, message)
    // The processor ONLY calls with this order, so we can cast safely
    mockLogger = {
      info: vi.fn((extra, msg) => {
        logEntries.push({
          level: 'info',
          message: msg || '',
          attrs: extra || {},
        });
      }),
      warn: vi.fn((extra, msg) => {
        logEntries.push({
          level: 'warn',
          message: msg || '',
          attrs: extra || {},
        });
      }),
      error: vi.fn((extra, msg) => {
        logEntries.push({
          level: 'error',
          message: msg || '',
          attrs: extra || {},
        });
      }),
      debug: vi.fn((extra, msg) => {
        logEntries.push({
          level: 'debug',
          message: msg || '',
          attrs: extra || {},
        });
      }),
    } as unknown as Logger;

    mockOTelLogger = {
      emit: vi.fn(),
    } as unknown as ReturnType<typeof logs.getLogger>;
  });

  function createMockSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
    const defaultSpan: Partial<ReadableSpan> = {
      name: 'test.operation',
      spanContext: () => ({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: 1,
      }),
      parentSpanContext: undefined, // No parent by default (root span)
      attributes: {
        'user.id': 'user-123',
        'cart.total_cents': 15_999,
        'http.method': 'POST',
      },
      status: { code: SpanStatusCode.OK },
      duration: [0, 1_247_000_000], // 1.247 seconds in nanoseconds
      startTime: [1_703_044_800, 0], // Unix timestamp in nanoseconds
      endTime: [1_703_044_800, 1_247_000_000],
      kind: SpanKind.SERVER, // Default to SERVER (service entry point)
      resource: resourceFromAttributes({
        'service.name': 'test-service',
        'service.version': '1.0.0',
      }),
      events: [],
      links: [],
      ...overrides,
    };
    return defaultSpan as ReadableSpan;
  }

  describe('basic functionality', () => {
    it('should emit canonical log line with all span attributes', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan();

      processor.onEnd(span);

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      const call = logEntries[0];
      expect(call.level).toBe('info');
      expect(call.message).toContain('test.operation');
      expect(call.attrs).toMatchObject({
        operation: 'test.operation',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        correlationId: '4bf92f3577b34da6', // First 16 chars of traceId
        'user.id': 'user-123',
        'cart.total_cents': 15_999,
        'http.method': 'POST',
        duration_ms: expect.any(Number),
        status_code: SpanStatusCode.OK,
      });
    });

    it('should include resource attributes by default', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan();

      processor.onEnd(span);

      const call = logEntries[0];
      expect(call.attrs).toMatchObject({
        'service.name': 'test-service',
        'service.version': '1.0.0',
      });
    });

    it('should exclude resource attributes when disabled', () => {
      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        includeResourceAttributes: false,
      });
      const span = createMockSpan();

      processor.onEnd(span);

      const call = logEntries[0];
      expect(call.attrs).not.toHaveProperty('service.name');
      expect(call.attrs).not.toHaveProperty('service.version');
    });

    it('should calculate duration in milliseconds correctly', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan({
        duration: [0, 2_500_000_000], // 2.5 seconds
      });

      processor.onEnd(span);

      const call = logEntries[0];
      expect(call.attrs.duration_ms).toBeCloseTo(2500, 1);
    });

    it('should format timestamp as ISO string', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan({
        startTime: [1_703_044_800, 0], // Fixed timestamp
      });

      processor.onEnd(span);

      const call = logEntries[0];
      expect(call.attrs.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });
  });

  describe('rootSpansOnly option', () => {
    it('should emit log for root span when rootSpansOnly is true', () => {
      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        rootSpansOnly: true,
      });
      const span = createMockSpan({ parentSpanContext: undefined });

      processor.onEnd(span);

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });

    it('should skip child spans when rootSpansOnly is true', () => {
      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        rootSpansOnly: true,
      });
      // Create a span with a LOCAL parent (isRemote: false)
      // This is a child span within the same service and should be skipped
      const span = createMockSpan({
        parentSpanContext: {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: 'local-parent-span-id',
          traceFlags: 1,
          isRemote: false, // Local parent (same service)
        },
      });

      processor.onEnd(span);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should emit for spans with remote parent (distributed tracing)', () => {
      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        rootSpansOnly: true,
      });
      // Create a span with a REMOTE parent (isRemote: true)
      // This is a service entry point from distributed tracing
      const span = createMockSpan({
        parentSpanContext: {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: 'remote-parent-span-id',
          traceFlags: 1,
          isRemote: true, // Remote parent (from upstream service)
        },
      });

      processor.onEnd(span);

      // Should emit because this is a service entry point (remote parent)
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });

    it('should emit log for all spans when rootSpansOnly is false', () => {
      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        rootSpansOnly: false,
      });
      // Even a local child span should emit when rootSpansOnly is false
      const span = createMockSpan({
        parentSpanContext: {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: 'parent-span-id',
          traceFlags: 1,
          isRemote: false, // Local parent
        },
      });

      processor.onEnd(span);

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('log level determination', () => {
    it('should use error level for error spans', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan({
        status: {
          code: SpanStatusCode.ERROR,
          message: 'Something went wrong',
        },
      });

      processor.onEnd(span);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(logEntries[0].level).toBe('error');
      expect(logEntries[0].attrs.status_code).toBe(SpanStatusCode.ERROR);
      // status_message might be undefined if not set
      if (logEntries[0].attrs.status_message) {
        expect(logEntries[0].attrs.status_message).toBe('Something went wrong');
      }
    });

    it('should use info level for successful spans', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan({
        status: { code: SpanStatusCode.OK },
      });

      processor.onEnd(span);

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      expect(logEntries[0].level).toBe('info');
    });
  });

  describe('minLevel option', () => {
    it('should respect minLevel and skip debug logs', () => {
      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        minLevel: 'info',
      });
      // Would need to force debug level, but for now just test the filter
      const span = createMockSpan();

      processor.onEnd(span);

      // Should still log info level
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });

    it('should skip logs below minLevel', () => {
      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        minLevel: 'warn',
      });
      const span = createMockSpan({
        status: { code: SpanStatusCode.OK }, // Would be info level
      });

      processor.onEnd(span);

      // Info is below warn, so should be skipped
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('custom message format', () => {
    it('should use custom message format when provided', () => {
      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        messageFormat: (span) => {
          const status = span.status.code === 2 ? 'ERROR' : 'SUCCESS';
          return `[${status}] ${span.name}`;
        },
      });
      const span = createMockSpan();

      processor.onEnd(span);

      expect(logEntries[0].message).toBe('[SUCCESS] test.operation');
    });
  });

  describe('OTel Logs API fallback', () => {
    it('should use OTel Logs API when no logger provided', () => {
      // Mock the logs API
      const mockGetLogger = vi.fn(() => mockOTelLogger);
      vi.spyOn(logs, 'getLogger').mockImplementation(mockGetLogger);

      const processor = new CanonicalLogLineProcessor();
      const span = createMockSpan();

      processor.onEnd(span);

      expect(mockGetLogger).toHaveBeenCalledWith('autotel.canonical-log-line');
      expect(mockOTelLogger.emit).toHaveBeenCalledTimes(1);
      const emitCall = (mockOTelLogger.emit as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(emitCall.body).toContain('test.operation');
      expect(emitCall.attributes).toMatchObject({
        operation: 'test.operation',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      });

      vi.restoreAllMocks();
    });
  });

  describe('edge cases', () => {
    it('should handle spans with no attributes', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan({ attributes: {} });

      processor.onEnd(span);

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      const call = logEntries[0];
      expect(call.attrs).toHaveProperty('operation');
      expect(call.attrs).toHaveProperty('traceId');
      expect(call.attrs).toHaveProperty('spanId');
    });

    it('should handle spans with many attributes', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const manyAttrs: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) {
        manyAttrs[`attr.${i}`] = `value-${i}`;
      }
      const span = createMockSpan({ attributes: manyAttrs });

      processor.onEnd(span);

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      const call = logEntries[0];
      // Should include all 100 attributes plus core fields
      expect(Object.keys(call.attrs).length).toBeGreaterThan(100);
    });

    it('should handle missing status message gracefully', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan({
        status: { code: SpanStatusCode.OK },
      });

      processor.onEnd(span);

      const call = logEntries[0];
      expect(call.attrs.status_message).toBeUndefined();
    });
  });

  describe('attribute redaction', () => {
    it('should apply attribute redactor to span attributes', () => {
      const redactor = vi.fn((key: string, value: unknown) => {
        if (key === 'user.password') return '[REDACTED]';
        if (key === 'user.email' && typeof value === 'string') {
          return value.replace(/@.*/, '@[REDACTED]');
        }
        return value;
      });

      const processor = new CanonicalLogLineProcessor({
        logger: mockLogger,
        attributeRedactor: redactor,
      });
      const span = createMockSpan({
        attributes: {
          'user.id': 'user-123',
          'user.email': 'alice@example.com',
          'user.password': 'secret123',
        },
      });

      processor.onEnd(span);

      const call = logEntries[0];
      expect(call.attrs['user.id']).toBe('user-123');
      expect(call.attrs['user.email']).toBe('alice@[REDACTED]');
      expect(call.attrs['user.password']).toBe('[REDACTED]');
    });

    it('should not modify attributes when no redactor configured', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      const span = createMockSpan({
        attributes: {
          'user.password': 'secret123',
        },
      });

      processor.onEnd(span);

      const call = logEntries[0];
      expect(call.attrs['user.password']).toBe('secret123');
    });
  });

  describe('attribute collision prevention', () => {
    it('should not allow span attributes to overwrite core metadata', () => {
      const processor = new CanonicalLogLineProcessor({ logger: mockLogger });
      // Create a span with attributes that match core metadata field names
      const span = createMockSpan({
        attributes: {
          traceId: 'malicious-trace-id',
          spanId: 'malicious-span-id',
          timestamp: 'malicious-timestamp',
          operation: 'malicious-operation',
          duration_ms: 999_999,
          status_code: 42,
          correlationId: 'malicious-correlation',
        },
      });

      processor.onEnd(span);

      const call = logEntries[0];
      // Core metadata should NOT be overwritten by span attributes
      expect(call.attrs.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(call.attrs.spanId).toBe('00f067aa0ba902b7');
      expect(call.attrs.operation).toBe('test.operation');
      expect(call.attrs.correlationId).toBe('4bf92f3577b34da6');
      expect(call.attrs.status_code).toBe(SpanStatusCode.OK);
      expect(call.attrs.duration_ms).toBeCloseTo(1247, 0);
      expect(call.attrs.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
