/**
 * Tests for FilteringSpanProcessor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FilteringSpanProcessor,
  type SpanFilterPredicate,
} from './filtering-span-processor';
import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';

/**
 * Mock span processor to capture forwarded spans
 */
class MockSpanProcessor implements SpanProcessor {
  public startedSpans: Span[] = [];
  public endedSpans: ReadableSpan[] = [];
  public flushed = false;
  public shutdownCalled = false;

  onStart(span: Span): void {
    this.startedSpans.push(span);
  }

  onEnd(span: ReadableSpan): void {
    this.endedSpans.push(span);
  }

  async forceFlush(): Promise<void> {
    this.flushed = true;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }

  reset(): void {
    this.startedSpans = [];
    this.endedSpans = [];
    this.flushed = false;
    this.shutdownCalled = false;
  }
}

/**
 * Create a mock ReadableSpan for testing
 */
function createMockSpan(
  name: string,
  instrumentationScopeName = 'test-scope',
  attributes: Record<string, unknown> = {},
): ReadableSpan {
  return {
    name,
    attributes,
    instrumentationScope: {
      name: instrumentationScopeName,
      version: '1.0.0',
    },
    spanContext: () => ({
      traceId: 'trace123',
      spanId: 'span123',
      traceFlags: 1,
    }),
    duration: [0, 1_000_000], // 1ms
    status: { code: 0 },
    kind: 0,
    startTime: [0, 0],
    endTime: [0, 1_000_000],
    ended: true,
    resource: {
      attributes: {},
      merge: () => ({}) as never,
    },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    events: [],
    links: [],
    parentSpanId: undefined,
  } as unknown as ReadableSpan;
}

describe('FilteringSpanProcessor', () => {
  let mockProcessor: MockSpanProcessor;

  beforeEach(() => {
    mockProcessor = new MockSpanProcessor();
  });

  describe('basic filtering', () => {
    it('should forward spans that pass the filter', () => {
      const filter: SpanFilterPredicate = (span) => span.name !== 'drop-me';
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      const keepSpan = createMockSpan('keep-me');
      filteringProcessor.onEnd(keepSpan);

      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0]).toBe(keepSpan);
    });

    it('should drop spans that fail the filter', () => {
      const filter: SpanFilterPredicate = (span) => span.name !== 'drop-me';
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      const dropSpan = createMockSpan('drop-me');
      filteringProcessor.onEnd(dropSpan);

      expect(mockProcessor.endedSpans).toHaveLength(0);
    });

    it('should always forward onStart (no filtering)', () => {
      const filter: SpanFilterPredicate = () => false; // Drop everything
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      const mockSpan = {} as Span;
      const mockContext = {} as Context;
      filteringProcessor.onStart(mockSpan, mockContext);

      expect(mockProcessor.startedSpans).toHaveLength(1);
      expect(mockProcessor.startedSpans[0]).toBe(mockSpan);
    });
  });

  describe('instrumentation scope filtering (primary use case)', () => {
    it('should filter out spans by instrumentation scope name', () => {
      const filter: SpanFilterPredicate = (span) =>
        span.instrumentationScope.name !== 'next.js';
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      const nextSpan = createMockSpan('GET /api/users', 'next.js');
      const autotelSpan = createMockSpan('createUser', 'autotel');

      filteringProcessor.onEnd(nextSpan);
      filteringProcessor.onEnd(autotelSpan);

      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0].instrumentationScope.name).toBe(
        'autotel',
      );
    });

    it('should support multiple instrumentation scope exclusions', () => {
      const excludedScopes = new Set([
        'next.js',
        '@opentelemetry/instrumentation-http',
      ]);
      const filter: SpanFilterPredicate = (span) =>
        !excludedScopes.has(span.instrumentationScope.name);
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      filteringProcessor.onEnd(createMockSpan('span1', 'next.js'));
      filteringProcessor.onEnd(
        createMockSpan('span2', '@opentelemetry/instrumentation-http'),
      );
      filteringProcessor.onEnd(createMockSpan('span3', 'autotel'));

      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0].name).toBe('span3');
    });
  });

  describe('error handling', () => {
    it('should forward span if filter throws (fail-open)', () => {
      const filter: SpanFilterPredicate = () => {
        throw new Error('Filter error');
      };
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      const span = createMockSpan('test-span');
      filteringProcessor.onEnd(span);

      // Span should be forwarded despite filter error
      expect(mockProcessor.endedSpans).toHaveLength(1);
    });
  });

  describe('lifecycle methods', () => {
    it('should forward forceFlush to wrapped processor', async () => {
      const filter: SpanFilterPredicate = () => true;
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      await filteringProcessor.forceFlush();

      expect(mockProcessor.flushed).toBe(true);
    });

    it('should forward shutdown to wrapped processor', async () => {
      const filter: SpanFilterPredicate = () => true;
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      await filteringProcessor.shutdown();

      expect(mockProcessor.shutdownCalled).toBe(true);
    });
  });

  describe('complex filtering scenarios', () => {
    it('should support attribute-based filtering', () => {
      const filter: SpanFilterPredicate = (span) =>
        span.attributes['http.route'] !== '/health';
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      filteringProcessor.onEnd(
        createMockSpan('GET /health', 'http', { 'http.route': '/health' }),
      );
      filteringProcessor.onEnd(
        createMockSpan('GET /api/users', 'http', {
          'http.route': '/api/users',
        }),
      );

      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0].name).toBe('GET /api/users');
    });

    it('should support span name pattern matching', () => {
      const filter: SpanFilterPredicate = (span) =>
        !span.name.startsWith('internal:');
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      filteringProcessor.onEnd(createMockSpan('internal:bootstrap'));
      filteringProcessor.onEnd(createMockSpan('internal:middleware'));
      filteringProcessor.onEnd(createMockSpan('createUser'));

      expect(mockProcessor.endedSpans).toHaveLength(1);
      expect(mockProcessor.endedSpans[0].name).toBe('createUser');
    });

    it('should support combining multiple filter conditions', () => {
      const filter: SpanFilterPredicate = (span) => {
        // Drop Next.js spans
        if (span.instrumentationScope.name === 'next.js') return false;
        // Drop health check spans
        if (span.name.includes('/health')) return false;
        // Keep everything else
        return true;
      };
      const filteringProcessor = new FilteringSpanProcessor(mockProcessor, {
        filter,
      });

      filteringProcessor.onEnd(createMockSpan('GET /api/users', 'next.js'));
      filteringProcessor.onEnd(createMockSpan('GET /health', 'http'));
      filteringProcessor.onEnd(createMockSpan('createUser', 'autotel'));
      filteringProcessor.onEnd(createMockSpan('GET /api/orders', 'http'));

      expect(mockProcessor.endedSpans).toHaveLength(2);
      expect(mockProcessor.endedSpans.map((s) => s.name)).toEqual([
        'createUser',
        'GET /api/orders',
      ]);
    });
  });
});
