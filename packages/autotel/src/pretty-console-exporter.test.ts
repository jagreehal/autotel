import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PrettyConsoleExporter,
  formatDuration,
  getDurationColor,
  hrTimeToMs,
  type PrettyConsoleExporterOptions,
} from './pretty-console-exporter';
import { SpanStatusCode } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Create a mock span for testing
 */
function createMockSpan(
  overrides: Partial<{
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId: string | undefined;
    startTime: [number, number];
    duration: [number, number];
    status: { code: number; message?: string };
    attributes: Record<string, unknown>;
    instrumentationScope: { name: string; version?: string };
  }> = {},
): ReadableSpan {
  const defaults = {
    name: 'test-span',
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId: 'b7ad6b7169203331',
    parentSpanId: undefined as string | undefined,
    startTime: [1000, 0] as [number, number],
    duration: [0, 50_000_000] as [number, number], // 50ms
    status: { code: SpanStatusCode.OK },
    attributes: {},
    instrumentationScope: { name: 'test', version: '1.0.0' },
  };

  const config = { ...defaults, ...overrides };

  // Build parentSpanContext if parentSpanId is provided
  const parentSpanContext = config.parentSpanId
    ? { traceId: config.traceId, spanId: config.parentSpanId, traceFlags: 1 }
    : undefined;

  return {
    name: config.name,
    spanContext: () => ({
      traceId: config.traceId,
      spanId: config.spanId,
      traceFlags: 1,
      isRemote: false,
    }),
    parentSpanContext,
    startTime: config.startTime,
    duration: config.duration,
    status: config.status,
    attributes: config.attributes,
    instrumentationScope: config.instrumentationScope,
    kind: 0,
    links: [],
    events: [],
    resource: { attributes: {} },
    ended: true,
    endTime: [config.startTime[0], config.startTime[1] + config.duration[1]],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

describe('PrettyConsoleExporter', () => {
  describe('utility functions', () => {
    describe('hrTimeToMs', () => {
      it('converts [seconds, nanoseconds] to milliseconds', () => {
        expect(hrTimeToMs([0, 0])).toBe(0);
        expect(hrTimeToMs([0, 1_000_000])).toBe(1); // 1ms
        expect(hrTimeToMs([0, 500_000])).toBe(0.5); // 0.5ms
        expect(hrTimeToMs([1, 0])).toBe(1000); // 1s
        expect(hrTimeToMs([1, 500_000_000])).toBe(1500); // 1.5s
        expect(hrTimeToMs([2, 250_000_000])).toBe(2250); // 2.25s
      });
    });

    describe('formatDuration', () => {
      it('formats sub-millisecond durations as microseconds', () => {
        expect(formatDuration(0.5)).toBe('500µs');
        expect(formatDuration(0.001)).toBe('1µs');
        expect(formatDuration(0.999)).toBe('999µs');
      });

      it('formats millisecond durations', () => {
        expect(formatDuration(1)).toBe('1ms');
        expect(formatDuration(50)).toBe('50ms');
        expect(formatDuration(999)).toBe('999ms');
      });

      it('formats second durations', () => {
        expect(formatDuration(1000)).toBe('1.00s');
        expect(formatDuration(1500)).toBe('1.50s');
        expect(formatDuration(2250)).toBe('2.25s');
        expect(formatDuration(60_000)).toBe('60.00s');
      });
    });

    describe('getDurationColor', () => {
      it('returns green for fast operations (<100ms)', () => {
        expect(getDurationColor(0)).toBe('green');
        expect(getDurationColor(50)).toBe('green');
        expect(getDurationColor(99)).toBe('green');
      });

      it('returns yellow for medium operations (100-500ms)', () => {
        expect(getDurationColor(100)).toBe('yellow');
        expect(getDurationColor(250)).toBe('yellow');
        expect(getDurationColor(499)).toBe('yellow');
      });

      it('returns red for slow operations (>=500ms)', () => {
        expect(getDurationColor(500)).toBe('red');
        expect(getDurationColor(1000)).toBe('red');
        expect(getDurationColor(5000)).toBe('red');
      });
    });
  });

  describe('constructor options', () => {
    it('uses default options when none provided', () => {
      const exporter = new PrettyConsoleExporter();
      // Can't directly access private options, but we can verify behavior
      expect(exporter).toBeDefined();
    });

    it('accepts custom options', () => {
      const options: PrettyConsoleExporterOptions = {
        colors: false,
        showAttributes: false,
        maxValueLength: 100,
        showScope: false,
        hideAttributes: ['secret'],
        showTraceId: true,
      };
      const exporter = new PrettyConsoleExporter(options);
      expect(exporter).toBeDefined();
    });
  });

  describe('export', () => {
    let consoleLogs: string[];
    let originalConsoleLog: typeof console.log;

    beforeEach(() => {
      consoleLogs = [];
      originalConsoleLog = console.log;
      console.log = (...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalConsoleLog;
    });

    it('calls resultCallback with SUCCESS for empty spans', () => {
      const exporter = new PrettyConsoleExporter({ colors: false });
      let result: { code: number } | undefined;

      exporter.export([], (r) => {
        result = r;
      });

      expect(result?.code).toBe(0); // ExportResultCode.SUCCESS
      expect(consoleLogs).toHaveLength(0);
    });

    it('prints spans with success status', () => {
      const exporter = new PrettyConsoleExporter({ colors: false });
      const span = createMockSpan({ name: 'GET /api/users' });

      exporter.export([span], () => {});

      expect(consoleLogs.some((log) => log.includes('✓'))).toBe(true);
      expect(consoleLogs.some((log) => log.includes('GET /api/users'))).toBe(
        true,
      );
    });

    it('prints spans with error status', () => {
      const exporter = new PrettyConsoleExporter({ colors: false });
      const span = createMockSpan({
        name: 'POST /api/orders',
        status: { code: SpanStatusCode.ERROR, message: 'Payment failed' },
      });

      exporter.export([span], () => {});

      expect(consoleLogs.some((log) => log.includes('✗'))).toBe(true);
      expect(consoleLogs.some((log) => log.includes('POST /api/orders'))).toBe(
        true,
      );
      expect(
        consoleLogs.some((log) => log.includes('Error: Payment failed')),
      ).toBe(true);
    });

    it('shows duration in output', () => {
      const exporter = new PrettyConsoleExporter({ colors: false });
      const span = createMockSpan({
        name: 'db.query',
        duration: [0, 123_000_000], // 123ms
      });

      exporter.export([span], () => {});

      expect(consoleLogs.some((log) => log.includes('123ms'))).toBe(true);
    });

    it('shows instrumentation scope name', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showScope: true,
      });
      const span = createMockSpan({
        name: 'query',
        instrumentationScope: { name: '@opentelemetry/instrumentation-pg' },
      });

      exporter.export([span], () => {});

      expect(consoleLogs.some((log) => log.includes('[pg]'))).toBe(true);
    });

    it('hides scope name when showScope is false', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showScope: false,
      });
      const span = createMockSpan({
        name: 'query',
        instrumentationScope: { name: '@opentelemetry/instrumentation-pg' },
      });

      exporter.export([span], () => {});

      expect(consoleLogs.some((log) => log.includes('[pg]'))).toBe(false);
    });

    it('shows attributes when enabled', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showAttributes: true,
      });
      const span = createMockSpan({
        name: 'db.query',
        attributes: {
          'db.system': 'postgresql',
          'db.name': 'users',
        },
      });

      exporter.export([span], () => {});

      expect(
        consoleLogs.some((log) => log.includes('db.system=postgresql')),
      ).toBe(true);
      expect(consoleLogs.some((log) => log.includes('db.name=users'))).toBe(
        true,
      );
    });

    it('hides attributes when showAttributes is false', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showAttributes: false,
      });
      const span = createMockSpan({
        name: 'db.query',
        attributes: { 'db.system': 'postgresql' },
      });

      exporter.export([span], () => {});

      expect(consoleLogs.some((log) => log.includes('db.system'))).toBe(false);
    });

    it('hides specific attributes from hideAttributes list', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showAttributes: true,
        hideAttributes: ['http.user_agent', 'secret'],
      });
      const span = createMockSpan({
        name: 'request',
        attributes: {
          'http.method': 'GET',
          'http.user_agent': 'Mozilla/5.0...',
          secret: 'should-not-show',
        },
      });

      exporter.export([span], () => {});

      expect(consoleLogs.some((log) => log.includes('http.method=GET'))).toBe(
        true,
      );
      expect(consoleLogs.some((log) => log.includes('http.user_agent'))).toBe(
        false,
      );
      expect(consoleLogs.some((log) => log.includes('secret'))).toBe(false);
    });

    it('truncates long attribute values', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showAttributes: true,
        maxValueLength: 20,
      });
      const span = createMockSpan({
        name: 'request',
        attributes: {
          'long.value':
            'This is a very long attribute value that should be truncated',
        },
      });

      exporter.export([span], () => {});

      expect(
        consoleLogs.some((log) =>
          log.includes('long.value=This is a very lo...'),
        ),
      ).toBe(true);
    });

    it('shows trace ID when showTraceId is true', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showTraceId: true,
      });
      const span = createMockSpan({
        traceId: 'abc123def456',
      });

      exporter.export([span], () => {});

      expect(
        consoleLogs.some((log) => log.includes('trace: abc123def456')),
      ).toBe(true);
    });
  });

  describe('span tree building', () => {
    let consoleLogs: string[];
    let originalConsoleLog: typeof console.log;

    beforeEach(() => {
      consoleLogs = [];
      originalConsoleLog = console.log;
      console.log = (...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalConsoleLog;
    });

    it('shows parent-child relationships with tree characters', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showAttributes: false,
      });

      const parentSpan = createMockSpan({
        name: 'parent',
        traceId: 'trace1',
        spanId: 'span1',
        parentSpanId: undefined,
      });

      const childSpan = createMockSpan({
        name: 'child',
        traceId: 'trace1',
        spanId: 'span2',
        parentSpanId: 'span1',
      });

      exporter.export([parentSpan, childSpan], () => {});

      // Parent should be at root level (no prefix)
      expect(consoleLogs.some((log) => log.includes('✓ parent'))).toBe(true);
      // Child should have tree prefix
      expect(consoleLogs.some((log) => log.includes('└─ ✓ child'))).toBe(true);
    });

    it('handles multiple children with proper tree characters', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showAttributes: false,
      });

      const parent = createMockSpan({
        name: 'parent',
        traceId: 'trace1',
        spanId: 'p1',
        parentSpanId: undefined,
        startTime: [1000, 0],
      });

      const child1 = createMockSpan({
        name: 'child1',
        traceId: 'trace1',
        spanId: 'c1',
        parentSpanId: 'p1',
        startTime: [1000, 100_000],
      });

      const child2 = createMockSpan({
        name: 'child2',
        traceId: 'trace1',
        spanId: 'c2',
        parentSpanId: 'p1',
        startTime: [1000, 200_000],
      });

      exporter.export([parent, child1, child2], () => {});

      // First child should use ├─
      expect(consoleLogs.some((log) => log.includes('├─ ✓ child1'))).toBe(true);
      // Last child should use └─
      expect(consoleLogs.some((log) => log.includes('└─ ✓ child2'))).toBe(true);
    });

    it('groups spans by trace ID', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showAttributes: false,
        showTraceId: true,
      });

      const span1 = createMockSpan({
        name: 'span1',
        traceId: 'trace-a',
        spanId: 's1',
      });

      const span2 = createMockSpan({
        name: 'span2',
        traceId: 'trace-b',
        spanId: 's2',
      });

      exporter.export([span1, span2], () => {});

      // Both trace IDs should appear
      expect(consoleLogs.some((log) => log.includes('trace: trace-a'))).toBe(
        true,
      );
      expect(consoleLogs.some((log) => log.includes('trace: trace-b'))).toBe(
        true,
      );
    });
  });

  describe('shutdown and forceFlush', () => {
    it('shutdown returns resolved promise', async () => {
      const exporter = new PrettyConsoleExporter();
      await expect(exporter.shutdown()).resolves.toBeUndefined();
    });

    it('forceFlush returns resolved promise', async () => {
      const exporter = new PrettyConsoleExporter();
      await expect(exporter.forceFlush()).resolves.toBeUndefined();
    });
  });

  describe('error handling', () => {
    let originalConsoleLog: typeof console.log;

    beforeEach(() => {
      originalConsoleLog = console.log;
    });

    afterEach(() => {
      console.log = originalConsoleLog;
    });

    it('returns SUCCESS even if formatting throws', () => {
      const exporter = new PrettyConsoleExporter({ colors: false });
      let result: { code: number } | undefined;

      // Mock console.log to throw
      console.log = () => {
        throw new Error('Console broken');
      };

      // Create a span that will trigger the error
      const span = createMockSpan({ name: 'test' });

      exporter.export([span], (r) => {
        result = r;
      });

      // Should still return success (fail-open behavior)
      expect(result?.code).toBe(0);
    });
  });

  describe('array attribute formatting', () => {
    let consoleLogs: string[];
    let originalConsoleLog: typeof console.log;

    beforeEach(() => {
      consoleLogs = [];
      originalConsoleLog = console.log;
      console.log = (...args: unknown[]) => {
        consoleLogs.push(args.map(String).join(' '));
      };
    });

    afterEach(() => {
      console.log = originalConsoleLog;
    });

    it('formats array attributes with brackets', () => {
      const exporter = new PrettyConsoleExporter({
        colors: false,
        showAttributes: true,
      });
      const span = createMockSpan({
        name: 'request',
        attributes: {
          tags: ['a', 'b', 'c'],
        },
      });

      exporter.export([span], () => {});

      expect(consoleLogs.some((log) => log.includes('tags=[a, b, c]'))).toBe(
        true,
      );
    });
  });
});
