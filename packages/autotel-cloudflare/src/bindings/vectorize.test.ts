import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { instrumentVectorize } from './vectorize';
import { bindingArg, vectorizeDouble } from '../testing/doubles.js';

describe('Vectorize Binding Instrumentation', () => {
  let mockTracer: any;
  let mockSpan: any;
  let mockVectorize: any;

  beforeEach(() => {
    mockSpan = {
      spanContext: () => ({
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 1,
      }),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      isRecording: () => true,
      updateName: vi.fn(),
      addEvent: vi.fn(),
    };

    mockTracer = {
      startActiveSpan: vi.fn((_name, _options, fn) => {
        return fn(mockSpan);
      }),
    };

    vi.spyOn(trace, 'getTracer').mockReturnValue(mockTracer);

    mockVectorize = {
      query: vi.fn(async () => ({
        matches: [
          { id: 'vec-1', score: 0.95 },
          { id: 'vec-2', score: 0.87 },
          { id: 'vec-3', score: 0.72 },
        ],
        count: 3,
      })),
      insert: vi.fn(async () => ({ mutationId: 'mut-1', count: 2 })),
      upsert: vi.fn(async () => ({ mutationId: 'mut-2', count: 3 })),
      deleteByIds: vi.fn(async () => ({ mutationId: 'mut-3', count: 1 })),
      getByIds: vi.fn(async () => [{ id: 'vec-1', values: [0.1, 0.2] }]),
      describe: vi.fn(async () => ({
        dimensions: 128,
        vectorCount: 1000,
        processedUpTo: 'ts-123',
      })),
      // Non-instrumented method
      toString: vi.fn(() => 'VectorizeIndex'),
    };
  });

  describe('query()', () => {
    it('should create span with correct attributes', async () => {
      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      // The source reads topK from args[0], so we pass a query object as the first argument
      await instrumented.query(bindingArg({ topK: 5 }), bindingArg({}));

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'Vectorize my-index: query',
        expect.objectContaining({
          kind: SpanKind.CLIENT,
          attributes: expect.objectContaining({
            'db.system.name': 'cloudflare-vectorize',
            'db.operation.name': 'query',
            'db.collection.name': 'my-index',
            'db.vectorize.top_k': 5,
          }),
        }),
        expect.any(Function),
      );
    });

    it('should record matches_count from result', async () => {
      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await instrumented.query(bindingArg([0.1, 0.2, 0.3]), bindingArg({}));

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'db.vectorize.matches_count',
        3,
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle query without topK in first argument', async () => {
      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await instrumented.query(bindingArg([0.1, 0.2, 0.3]), bindingArg({}));

      const attributes = mockTracer.startActiveSpan.mock.calls[0][1].attributes;
      expect(attributes['db.vectorize.top_k']).toBeUndefined();
    });
  });

  describe('insert()', () => {
    it('should set vectors_count from input array length', async () => {
      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      const vectors = [
        { id: 'vec-1', values: [0.1, 0.2] },
        { id: 'vec-2', values: [0.3, 0.4] },
      ];
      await instrumented.insert(bindingArg(vectors));

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'Vectorize my-index: insert',
        expect.objectContaining({
          kind: SpanKind.CLIENT,
          attributes: expect.objectContaining({
            'db.system.name': 'cloudflare-vectorize',
            'db.operation.name': 'insert',
            'db.collection.name': 'my-index',
            'db.vectorize.vectors_count': 2,
          }),
        }),
        expect.any(Function),
      );

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('upsert()', () => {
    it('should set vectors_count from input array length', async () => {
      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      const vectors = [
        { id: 'vec-1', values: [0.1, 0.2] },
        { id: 'vec-2', values: [0.3, 0.4] },
        { id: 'vec-3', values: [0.5, 0.6] },
      ];
      await instrumented.upsert(bindingArg(vectors));

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'Vectorize my-index: upsert',
        expect.objectContaining({
          kind: SpanKind.CLIENT,
          attributes: expect.objectContaining({
            'db.system.name': 'cloudflare-vectorize',
            'db.operation.name': 'upsert',
            'db.collection.name': 'my-index',
            'db.vectorize.vectors_count': 3,
          }),
        }),
        expect.any(Function),
      );

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('deleteByIds()', () => {
    it('should create correct span', async () => {
      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await instrumented.deleteByIds(['vec-1', 'vec-2']);

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'Vectorize my-index: deleteByIds',
        expect.objectContaining({
          kind: SpanKind.CLIENT,
          attributes: expect.objectContaining({
            'db.system.name': 'cloudflare-vectorize',
            'db.operation.name': 'deleteByIds',
            'db.collection.name': 'my-index',
          }),
        }),
        expect.any(Function),
      );

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('describe()', () => {
    it('should create correct span', async () => {
      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await instrumented.describe();

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'Vectorize my-index: describe',
        expect.objectContaining({
          kind: SpanKind.CLIENT,
          attributes: expect.objectContaining({
            'db.system.name': 'cloudflare-vectorize',
            'db.operation.name': 'describe',
            'db.collection.name': 'my-index',
          }),
        }),
        expect.any(Function),
      );

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('this-binding', () => {
    it('should invoke methods with original object as this, not the proxy', async () => {
      let receivedThis: any;
      const mockVec = {
        query: vi.fn(async function (this: any) {
          // eslint-disable-next-line unicorn/no-this-assignment, @typescript-eslint/no-this-alias
          receivedThis = this;
          return { matches: [], count: 0 };
        }),
        insert: vi.fn(async () => ({ mutationId: 'mut-1', count: 0 })),
        upsert: vi.fn(async () => ({ mutationId: 'mut-2', count: 0 })),
        deleteByIds: vi.fn(async () => ({ mutationId: 'mut-3', count: 0 })),
        getByIds: vi.fn(async () => []),
        describe: vi.fn(async () => ({
          dimensions: 128,
          vectorCount: 0,
          processedUpTo: '',
        })),
      };

      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVec),
        'test',
      );
      await instrumented.query([0.1, 0.2], {});
      expect(receivedThis).toBe(mockVec);
    });
  });

  describe('Error handling', () => {
    it('should record exception and set error status on query() failure', async () => {
      mockVectorize.query = vi.fn(async () => {
        throw new Error('Vectorize query failed');
      });

      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await expect(
        instrumented.query(bindingArg([0.1, 0.2]), bindingArg({})),
      ).rejects.toThrow('Vectorize query failed');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Vectorize query failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record exception and set error status on insert() failure', async () => {
      mockVectorize.insert = vi.fn(async () => {
        throw new Error('Insert failed');
      });

      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await expect(
        instrumented.insert(bindingArg([{ id: 'v1', values: [0.1] }])),
      ).rejects.toThrow('Insert failed');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Insert failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record exception and set error status on upsert() failure', async () => {
      mockVectorize.upsert = vi.fn(async () => {
        throw new Error('Upsert failed');
      });

      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await expect(
        instrumented.upsert(bindingArg([{ id: 'v1', values: [0.1] }])),
      ).rejects.toThrow('Upsert failed');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Upsert failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record exception and set error status on deleteByIds() failure', async () => {
      mockVectorize.deleteByIds = vi.fn(async () => {
        throw new Error('Delete failed');
      });

      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await expect(instrumented.deleteByIds(['vec-1'])).rejects.toThrow(
        'Delete failed',
      );

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Delete failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record exception and set error status on describe() failure', async () => {
      mockVectorize.describe = vi.fn(async () => {
        throw new Error('Describe failed');
      });

      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await expect(instrumented.describe()).rejects.toThrow('Describe failed');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'Describe failed',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      mockVectorize.query = vi.fn(async () => {
        throw 'string error';
      });

      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      await expect(
        instrumented.query(bindingArg([0.1]), bindingArg({})),
      ).rejects.toThrow('string error');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'string error',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('Non-instrumented methods', () => {
    it('should pass through non-traced methods without creating spans', () => {
      const instrumented = instrumentVectorize(
        vectorizeDouble(mockVectorize),
        'my-index',
      );

      const result = instrumented.toString();

      expect(result).toBe('VectorizeIndex');
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });
  });

  describe('Default index name', () => {
    it('should use "vectorize" as default index name when none provided', async () => {
      const instrumented = instrumentVectorize(mockVectorize);

      await instrumented.query(bindingArg([0.1, 0.2]), bindingArg({}));

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'Vectorize vectorize: query',
        expect.objectContaining({
          attributes: expect.objectContaining({
            'db.collection.name': 'vectorize',
          }),
        }),
        expect.any(Function),
      );
    });
  });
});
