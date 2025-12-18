/**
 * Tests for SpanNameNormalizingProcessor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SpanNameNormalizingProcessor,
  NORMALIZER_PATTERNS,
  NORMALIZER_PRESETS,
  type SpanNameNormalizerFn,
} from './span-name-normalizer';
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
}

/**
 * Create a mock Span with updateName capability
 */
function createMockSpan(initialName: string): Span {
  const span = {
    _name: initialName,
    updateName: vi.fn(function (this: { _name: string }, newName: string) {
      this._name = newName;
    }),
    spanContext: () => ({
      traceId: 'trace123',
      spanId: 'span123',
      traceFlags: 1,
    }),
  };

  // Define name as a getter to return current _name
  Object.defineProperty(span, 'name', {
    get() {
      return span._name;
    },
    enumerable: true,
  });

  return span as unknown as Span;
}

describe('SpanNameNormalizingProcessor', () => {
  let mockProcessor: MockSpanProcessor;

  beforeEach(() => {
    mockProcessor = new MockSpanProcessor();
  });

  describe('custom normalizer function', () => {
    it('should normalize span names using custom function', () => {
      const normalizer: SpanNameNormalizerFn = (name) =>
        name.replaceAll(/\/[0-9]+/g, '/:id');
      const processor = new SpanNameNormalizingProcessor(mockProcessor, {
        normalizer,
      });

      const span = createMockSpan('GET /users/123/posts/456');
      processor.onStart(span, {} as Context);

      expect(span.updateName).toHaveBeenCalledWith('GET /users/:id/posts/:id');
    });

    it('should not call updateName if name unchanged', () => {
      const normalizer: SpanNameNormalizerFn = (name) => name; // No change
      const processor = new SpanNameNormalizingProcessor(mockProcessor, {
        normalizer,
      });

      const span = createMockSpan('createUser');
      processor.onStart(span, {} as Context);

      expect(span.updateName).not.toHaveBeenCalled();
    });

    it('should forward span to wrapped processor', () => {
      const normalizer: SpanNameNormalizerFn = (name) => name;
      const processor = new SpanNameNormalizingProcessor(mockProcessor, {
        normalizer,
      });

      const span = createMockSpan('test');
      const context = {} as Context;
      processor.onStart(span, context);

      expect(mockProcessor.startedSpans).toHaveLength(1);
    });
  });

  describe('built-in presets', () => {
    describe('rest-api preset', () => {
      it('should normalize numeric IDs', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'rest-api',
        });

        const span = createMockSpan('GET /users/123');
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('GET /users/:id');
      });

      it('should normalize UUIDs', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'rest-api',
        });

        const span = createMockSpan(
          'GET /items/550e8400-e29b-41d4-a716-446655440000',
        );
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('GET /items/:uuid');
      });

      it('should normalize MongoDB ObjectIds', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'rest-api',
        });

        const span = createMockSpan('GET /docs/507f1f77bcf86cd799439011');
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('GET /docs/:objectId');
      });

      it('should normalize ISO dates', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'rest-api',
        });

        const span = createMockSpan('GET /logs/2024-01-15');
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('GET /logs/:date');
      });

      it('should normalize timestamps', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'rest-api',
        });

        const span = createMockSpan('GET /events/1705334400');
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('GET /events/:timestamp');
      });

      it('should normalize emails', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'rest-api',
        });

        const span = createMockSpan('GET /users/john@example.com');
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('GET /users/:email');
      });

      it('should handle multiple dynamic segments', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'rest-api',
        });

        const span = createMockSpan('GET /users/123/posts/456/comments/789');
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith(
          'GET /users/:id/posts/:id/comments/:id',
        );
      });
    });

    describe('minimal preset', () => {
      it('should only normalize numeric IDs and UUIDs', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'minimal',
        });

        const span = createMockSpan('GET /users/123');
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('GET /users/:id');
      });

      it('should not normalize ObjectIds (only rest-api does)', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'minimal',
        });

        // ObjectId is 24 hex chars - minimal doesn't handle this
        const span = createMockSpan('GET /docs/507f1f77bcf86cd799439011');
        processor.onStart(span, {} as Context);

        // Minimal only does numeric IDs and UUIDs, not ObjectIds
        expect(span.updateName).not.toHaveBeenCalled();
      });
    });

    describe('graphql preset', () => {
      it('should normalize UUIDs in paths', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'graphql',
        });

        const span = createMockSpan(
          'POST /graphql/550e8400-e29b-41d4-a716-446655440000',
        );
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('POST /graphql/:uuid');
      });

      it('should normalize path-style IDs in GraphQL endpoints', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'graphql',
        });

        const span = createMockSpan('POST /graphql/users/123');
        processor.onStart(span, {} as Context);

        expect(span.updateName).toHaveBeenCalledWith('POST /graphql/users/:id');
      });

      it('should not modify pure operation names without IDs', () => {
        const processor = new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'graphql',
        });

        const span = createMockSpan('query GetUserById');
        processor.onStart(span, {} as Context);

        // No change expected since there are no path segments to normalize
        expect(span.updateName).not.toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('should keep original name if normalizer throws (fail-open)', () => {
      const normalizer: SpanNameNormalizerFn = () => {
        throw new Error('Normalizer error');
      };
      const processor = new SpanNameNormalizingProcessor(mockProcessor, {
        normalizer,
      });

      const span = createMockSpan('GET /users/123');
      processor.onStart(span, {} as Context);

      // Should not throw and should not call updateName
      expect(span.updateName).not.toHaveBeenCalled();
      expect(mockProcessor.startedSpans).toHaveLength(1);
    });

    it('should throw for unknown preset', () => {
      expect(() => {
        new SpanNameNormalizingProcessor(mockProcessor, {
          normalizer: 'unknown-preset' as 'rest-api',
        });
      }).toThrow('Unknown span name normalizer preset');
    });
  });

  describe('lifecycle methods', () => {
    it('should forward onEnd to wrapped processor', () => {
      const processor = new SpanNameNormalizingProcessor(mockProcessor, {
        normalizer: 'rest-api',
      });

      const span = { name: 'test' } as ReadableSpan;
      processor.onEnd(span);

      expect(mockProcessor.endedSpans).toHaveLength(1);
    });

    it('should forward forceFlush to wrapped processor', async () => {
      const processor = new SpanNameNormalizingProcessor(mockProcessor, {
        normalizer: 'rest-api',
      });

      await processor.forceFlush();

      expect(mockProcessor.flushed).toBe(true);
    });

    it('should forward shutdown to wrapped processor', async () => {
      const processor = new SpanNameNormalizingProcessor(mockProcessor, {
        normalizer: 'rest-api',
      });

      await processor.shutdown();

      expect(mockProcessor.shutdownCalled).toBe(true);
    });
  });
});

describe('NORMALIZER_PATTERNS', () => {
  it('should export regex patterns for advanced users', () => {
    expect(NORMALIZER_PATTERNS.numericId).toBeInstanceOf(RegExp);
    expect(NORMALIZER_PATTERNS.uuid).toBeInstanceOf(RegExp);
    expect(NORMALIZER_PATTERNS.objectId).toBeInstanceOf(RegExp);
    expect(NORMALIZER_PATTERNS.isoDate).toBeInstanceOf(RegExp);
    expect(NORMALIZER_PATTERNS.timestamp).toBeInstanceOf(RegExp);
    expect(NORMALIZER_PATTERNS.email).toBeInstanceOf(RegExp);
  });

  describe('pattern matching', () => {
    it('numericId should match numeric path segments', () => {
      expect('/users/123'.replace(NORMALIZER_PATTERNS.numericId, '/:id')).toBe(
        '/users/:id',
      );
      expect(
        '/users/123/posts'.replace(NORMALIZER_PATTERNS.numericId, '/:id'),
      ).toBe('/users/:id/posts');
    });

    it('uuid should match standard UUIDs', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(`/items/${uuid}`.replace(NORMALIZER_PATTERNS.uuid, '/:uuid')).toBe(
        '/items/:uuid',
      );
    });

    it('objectId should match MongoDB ObjectIds', () => {
      expect(
        '/docs/507f1f77bcf86cd799439011'.replace(
          NORMALIZER_PATTERNS.objectId,
          '/:objectId',
        ),
      ).toBe('/docs/:objectId');
    });
  });
});

describe('NORMALIZER_PRESETS', () => {
  it('should export preset functions for advanced users', () => {
    expect(typeof NORMALIZER_PRESETS['rest-api']).toBe('function');
    expect(typeof NORMALIZER_PRESETS['graphql']).toBe('function');
    expect(typeof NORMALIZER_PRESETS['minimal']).toBe('function');
  });

  it('presets should be usable directly', () => {
    const result = NORMALIZER_PRESETS['rest-api']('GET /users/123/posts/456');
    expect(result).toBe('GET /users/:id/posts/:id');
  });
});
