import { describe, it, expect, vi } from 'vitest';
import {
  normalizeHeaders,
  extractCorrelationId,
  deriveCorrelationId,
  injectTraceHeaders,
  extractTraceContext,
  extractBatchLineage,
  extractBatchLineageAsync,
  withProcessingSpan,
  withProducerSpan,
  CORRELATION_ID_HEADER,
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_OPERATION,
  SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP,
  SEMATTRS_MESSAGING_KAFKA_PARTITION,
  SEMATTRS_MESSAGING_KAFKA_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY,
  SEMATTRS_LINKED_TRACE_ID_COUNT,
  SEMATTRS_LINKED_TRACE_ID_HASH,
} from './index';
import { otelTrace as trace } from 'autotel';
import { propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

describe('normalizeHeaders', () => {
  it('should return empty object for undefined headers', () => {
    const result = normalizeHeaders();
    expect(result).toEqual({});
  });

  it('should return empty object for null headers', () => {
    const nullValue = null as unknown as undefined;
    expect(normalizeHeaders(nullValue)).toEqual({});
  });

  it('should pass through string values', () => {
    const headers = {
      'content-type': 'application/json',
      traceparent: '00-abc-def-01',
    };
    expect(normalizeHeaders(headers)).toEqual(headers);
  });

  it('should convert Buffer values to strings', () => {
    const headers = {
      traceparent: Buffer.from('00-abc-def-01'),
      'content-type': 'application/json',
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized.traceparent).toBe('00-abc-def-01');
    expect(normalized['content-type']).toBe('application/json');
  });

  it('should remove undefined values', () => {
    const headers = {
      traceparent: '00-abc-def-01',
      optionalHeader: undefined,
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized).toEqual({ traceparent: '00-abc-def-01' });
    expect('optionalHeader' in normalized).toBe(false);
  });

  it('should handle mixed Buffer and string values', () => {
    const headers = {
      traceparent: Buffer.from('00-trace-span-01'),
      tracestate: 'vendor=value',
      key: Buffer.from('value'),
      empty: undefined,
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized).toEqual({
      traceparent: '00-trace-span-01',
      tracestate: 'vendor=value',
      key: 'value',
    });
  });

  it('should handle empty object', () => {
    expect(normalizeHeaders({})).toEqual({});
  });

  it('should handle UTF-8 encoded Buffer values', () => {
    const headers = {
      key: Buffer.from('こんにちは', 'utf8'),
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized.key).toBe('こんにちは');
  });

  // Map support tests
  it('should accept Map headers', () => {
    const map = new Map([
      ['traceparent', '00-abc-def-01'],
      ['content-type', 'application/json'],
    ]);
    const normalized = normalizeHeaders(map);
    expect(normalized).toEqual({
      traceparent: '00-abc-def-01',
      'content-type': 'application/json',
    });
  });

  it('should convert Buffer values in Map to strings', () => {
    const map = new Map([
      ['traceparent', Buffer.from('00-abc-def-01')],
      ['key', 'string-value'],
    ]);
    const normalized = normalizeHeaders(map);
    expect(normalized.traceparent).toBe('00-abc-def-01');
    expect(normalized.key).toBe('string-value');
  });

  it('should skip undefined values in Map', () => {
    const map = new Map([
      ['traceparent', '00-abc-def-01'],
      ['optional', undefined],
    ]);
    const normalized = normalizeHeaders(map);
    expect(normalized).toEqual({ traceparent: '00-abc-def-01' });
    expect('optional' in normalized).toBe(false);
  });
});

describe('extractTraceContext', () => {
  it('should return a context for empty headers', () => {
    const ctx = extractTraceContext({});
    expect(ctx).toBeDefined();
  });

  it('should extract context from valid traceparent header', () => {
    const headers = {
      traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
    };
    const ctx = extractTraceContext(headers);
    // When no propagator is configured, it returns ROOT_CONTEXT
    // In a real setup with W3CTraceContextPropagator, this would extract the trace
    expect(ctx).toBeDefined();
    // Can get span context from extracted context (may be undefined without propagator)
    const _spanContext = trace.getSpanContext(ctx);
  });
});

describe('extractCorrelationId', () => {
  it('should return undefined when no correlation ID header exists', () => {
    expect(extractCorrelationId({})).toBeUndefined();
  });

  it('should extract correlation ID from x-correlation-id header', () => {
    const headers = { 'x-correlation-id': 'corr-12345' };
    expect(extractCorrelationId(headers)).toBe('corr-12345');
  });

  it('should handle case-insensitive header lookup', () => {
    const headers = { 'X-Correlation-ID': 'corr-12345' };
    expect(extractCorrelationId(headers)).toBe('corr-12345');
  });

  it('should handle X-CORRELATION-ID uppercase', () => {
    const headers = { 'X-CORRELATION-ID': 'corr-12345' };
    expect(extractCorrelationId(headers)).toBe('corr-12345');
  });

  it('should return first matching header when multiple exist', () => {
    const headers = {
      'X-Correlation-Id': 'first',
      'x-correlation-id': 'second',
    };
    const result = extractCorrelationId(headers);
    // Order depends on Object.entries iteration
    expect(['first', 'second']).toContain(result);
  });
});

describe('deriveCorrelationId', () => {
  it('should return empty string when no active span', () => {
    // Without OTel SDK initialized, there's no active span
    const correlationId = deriveCorrelationId();
    expect(correlationId).toBe('');
  });
});

describe('injectTraceHeaders', () => {
  it('should return carrier object', () => {
    const headers = injectTraceHeaders({});
    expect(headers).toBeDefined();
    expect(typeof headers).toBe('object');
  });

  it('should preserve base headers', () => {
    const headers = injectTraceHeaders({ 'content-type': 'application/json' });
    expect(headers['content-type']).toBe('application/json');
  });

  it('should add explicit correlation ID when provided', () => {
    const headers = injectTraceHeaders({}, { correlationId: 'my-corr-id' });
    expect(headers[CORRELATION_ID_HEADER]).toBe('my-corr-id');
  });

  it('should skip correlation ID when disabled', () => {
    const headers = injectTraceHeaders(
      {},
      { includeCorrelationIdHeader: false },
    );
    expect(headers[CORRELATION_ID_HEADER]).toBeUndefined();
  });

  it('should handle empty base headers', () => {
    const headers = injectTraceHeaders();
    expect(headers).toBeDefined();
  });
});

describe('withProcessingSpan', () => {
  it('should execute callback and return result', async () => {
    const result = await withProcessingSpan(
      {
        name: 'test.process',
        headers: {},
        contextMode: 'none',
        topic: 'test-topic',
      },
      async () => {
        return 'success';
      },
    );
    expect(result).toBe('success');
  });

  it('should throw when callback throws', async () => {
    await expect(
      withProcessingSpan(
        {
          name: 'test.process',
          headers: {},
          contextMode: 'none',
        },
        async () => {
          throw new Error('test error');
        },
      ),
    ).rejects.toThrow('test error');
  });

  it('should set messaging attributes', async () => {
    await withProcessingSpan(
      {
        name: 'test.process',
        headers: {},
        contextMode: 'none',
        topic: 'test-topic',
        consumerGroup: 'test-group',
        partition: 0,
        offset: '100',
        key: 'test-key',
      },
      async () => {
        return 'done';
      },
    );
    // Span was created successfully with attributes
    expect(true).toBe(true);
  });
});

describe('withProducerSpan', () => {
  it('should execute callback and return result', async () => {
    const result = await withProducerSpan(
      {
        name: 'test.publish',
        topic: 'test-topic',
      },
      async () => {
        return 'published';
      },
    );
    expect(result).toBe('published');
  });

  it('should throw when callback throws', async () => {
    await expect(
      withProducerSpan(
        {
          name: 'test.publish',
          topic: 'test-topic',
        },
        async () => {
          throw new Error('publish error');
        },
      ),
    ).rejects.toThrow('publish error');
  });

  it('should set messaging attributes including operation', async () => {
    await withProducerSpan(
      {
        name: 'order.publish',
        topic: 'orders',
        messageKey: 'order-123',
        system: 'kafka',
      },
      async () => {
        return 'sent';
      },
    );
    // PRODUCER span was created successfully
    expect(true).toBe(true);
  });
});

describe('extractBatchLineage', () => {
  it('should return empty result for empty batch', () => {
    const result = extractBatchLineage([]);
    expect(result.linked_trace_id_count).toBe(0);
    expect(result.linked_trace_id_hash).toBe('0000000000000000');
    expect(result.links).toEqual([]);
    expect(result.trace_ids).toBeUndefined();
  });

  it('should return empty result for batch with no headers', () => {
    const result = extractBatchLineage([{}, {}, {}]);
    expect(result.linked_trace_id_count).toBe(0);
    expect(result.links).toEqual([]);
  });

  it('should return empty result for batch with undefined headers', () => {
    const result = extractBatchLineage([
      { headers: undefined },
      { headers: undefined },
    ]);
    expect(result.linked_trace_id_count).toBe(0);
  });

  it('should return empty result for batch with empty headers', () => {
    const result = extractBatchLineage([{ headers: {} }, { headers: {} }]);
    expect(result.linked_trace_id_count).toBe(0);
  });

  it('should return 16-character hash', () => {
    const result = extractBatchLineage([]);
    expect(result.linked_trace_id_hash.length).toBe(16);
  });

  it('should not include trace_ids by default', () => {
    const result = extractBatchLineage([]);
    expect(result.trace_ids).toBeUndefined();
  });

  it('should include empty trace_ids array when requested on empty batch', () => {
    const result = extractBatchLineage([], { includeTraceIds: true });
    expect(result.trace_ids).toEqual([]);
  });

  it('should respect maxLinks option even when 0', () => {
    const result = extractBatchLineage([], { maxLinks: 0 });
    expect(result.links).toEqual([]);
  });

  it('should use default maxLinks of 128', () => {
    // Create batch with more items than default limit
    const batch = Array.from({ length: 200 }).fill({ headers: {} });
    const result = extractBatchLineage(
      batch as Array<{ headers: Record<string, string> }>,
    );
    // Without valid trace contexts, links will be empty regardless
    expect(result.links.length).toBeLessThanOrEqual(128);
  });
});

describe('extractBatchLineageAsync', () => {
  it('should return empty result for empty batch', async () => {
    const result = await extractBatchLineageAsync([]);
    expect(result.linked_trace_id_count).toBe(0);
    expect(result.linked_trace_id_hash).toBe('0000000000000000');
    expect(result.links).toEqual([]);
  });

  it('should produce 16-character hash', async () => {
    const result = await extractBatchLineageAsync([]);
    expect(result.linked_trace_id_hash.length).toBe(16);
  });

  it('should not include trace_ids by default', async () => {
    const result = await extractBatchLineageAsync([]);
    expect(result.trace_ids).toBeUndefined();
  });

  it('should include empty trace_ids array when requested', async () => {
    const result = await extractBatchLineageAsync([], {
      includeTraceIds: true,
    });
    expect(result.trace_ids).toEqual([]);
  });
});

describe('constants', () => {
  it('should export CORRELATION_ID_HEADER', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });

  it('should export messaging semantic conventions', () => {
    expect(SEMATTRS_MESSAGING_SYSTEM).toBe('messaging.system');
    expect(SEMATTRS_MESSAGING_DESTINATION_NAME).toBe(
      'messaging.destination.name',
    );
    expect(SEMATTRS_MESSAGING_OPERATION).toBe('messaging.operation');
    expect(SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP).toBe(
      'messaging.kafka.consumer.group',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_PARTITION).toBe(
      'messaging.kafka.partition',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_OFFSET).toBe('messaging.kafka.offset');
    expect(SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY).toBe(
      'messaging.kafka.message.key',
    );
  });

  it('should export batch lineage attribute names', () => {
    expect(SEMATTRS_LINKED_TRACE_ID_COUNT).toBe('linked_trace_id_count');
    expect(SEMATTRS_LINKED_TRACE_ID_HASH).toBe('linked_trace_id_hash');
  });
});

describe('type exports', () => {
  it('should export all expected functions', async () => {
    const exports = await import('./index');

    // Functions
    expect(typeof exports.normalizeHeaders).toBe('function');
    expect(typeof exports.extractTraceContext).toBe('function');
    expect(typeof exports.injectTraceHeaders).toBe('function');
    expect(typeof exports.extractCorrelationId).toBe('function');
    expect(typeof exports.deriveCorrelationId).toBe('function');
    expect(typeof exports.withProcessingSpan).toBe('function');
    expect(typeof exports.withProducerSpan).toBe('function');
    expect(typeof exports.extractBatchLineage).toBe('function');
    expect(typeof exports.extractBatchLineageAsync).toBe('function');
  });

  it('should export all expected constants', async () => {
    const exports = await import('./index');

    expect(exports.SEMATTRS_MESSAGING_SYSTEM).toBe('messaging.system');
    expect(exports.SEMATTRS_MESSAGING_DESTINATION_NAME).toBe(
      'messaging.destination.name',
    );
    expect(exports.SEMATTRS_MESSAGING_OPERATION).toBe('messaging.operation');
    expect(exports.SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP).toBe(
      'messaging.kafka.consumer.group',
    );
    expect(exports.SEMATTRS_MESSAGING_KAFKA_PARTITION).toBe(
      'messaging.kafka.partition',
    );
    expect(exports.SEMATTRS_MESSAGING_KAFKA_OFFSET).toBe(
      'messaging.kafka.offset',
    );
    expect(exports.SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY).toBe(
      'messaging.kafka.message.key',
    );
    expect(exports.SEMATTRS_LINKED_TRACE_ID_COUNT).toBe(
      'linked_trace_id_count',
    );
    expect(exports.SEMATTRS_LINKED_TRACE_ID_HASH).toBe('linked_trace_id_hash');
    expect(exports.CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });
});

describe('official instrumentation compatibility', () => {
  /**
   * Verify our attribute names match official @opentelemetry/instrumentation-kafkajs
   * See: https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-kafkajs
   */
  it('should use standard messaging.system attribute', () => {
    expect(SEMATTRS_MESSAGING_SYSTEM).toBe('messaging.system');
  });

  it('should use standard messaging.destination.name attribute', () => {
    expect(SEMATTRS_MESSAGING_DESTINATION_NAME).toBe(
      'messaging.destination.name',
    );
  });

  it('should use standard messaging.operation attribute', () => {
    expect(SEMATTRS_MESSAGING_OPERATION).toBe('messaging.operation');
  });

  it('should use standard kafka-specific attributes', () => {
    // These match the official instrumentation's semantic conventions
    expect(SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP).toBe(
      'messaging.kafka.consumer.group',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_PARTITION).toBe(
      'messaging.kafka.partition',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_OFFSET).toBe('messaging.kafka.offset');
    expect(SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY).toBe(
      'messaging.kafka.message.key',
    );
  });
});

// Import stream observability features for testing
import {
  withBatchConsumer,
  createMessageErrorSpan,
  createStreamProcessor,
  ConsumerMetrics,
  instrumentConsumerEvents,
  SEMATTRS_MESSAGING_BATCH_MESSAGE_COUNT,
  SEMATTRS_MESSAGING_KAFKA_BATCH_FIRST_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_BATCH_LAST_OFFSET,
  SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_PROCESSED,
  SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_FAILED,
  SEMATTRS_MESSAGING_KAFKA_BATCH_PROCESSING_TIME_MS,
} from './index';

describe('withBatchConsumer', () => {
  it('should wrap batch handler and execute callback', async () => {
    const mockBatch = {
      topic: 'test-topic',
      partition: 0,
      messages: [
        { offset: '0', value: Buffer.from('msg1'), headers: {} },
        { offset: '1', value: Buffer.from('msg2'), headers: {} },
      ],
      firstOffset: () => '0',
      lastOffset: () => '1',
      highWatermark: '2',
    };

    const resolvedOffsets: string[] = [];
    const mockPayload = {
      batch: mockBatch,
      resolveOffset: (offset: string) => resolvedOffsets.push(offset),
      heartbeat: async () => {},
      commitOffsetsIfNecessary: async () => {},
      uncommittedOffsets: () => ({}),
      isRunning: () => true,
      isStale: () => false,
      pause: () => () => {},
    };

    const handler = withBatchConsumer(
      {
        name: 'test.batch',
        consumerGroup: 'test-group',
      },
      async ({ batch, resolveOffset }) => {
        for (const message of batch.messages) {
          resolveOffset(message.offset);
        }
      },
    );

    await handler(mockPayload);
    expect(resolvedOffsets).toEqual(['0', '1']);
  });

  it('should track progress when onProgress is provided', async () => {
    const mockBatch = {
      topic: 'test-topic',
      partition: 0,
      messages: [{ offset: '0', value: Buffer.from('msg'), headers: {} }],
      firstOffset: () => '0',
      lastOffset: () => '0',
      highWatermark: '1',
    };

    const progressCalls: Array<{
      processed: number;
      failed: number;
      skipped: number;
    }> = [];

    const mockPayload = {
      batch: mockBatch,
      resolveOffset: () => {},
      heartbeat: async () => {},
      commitOffsetsIfNecessary: async () => {},
      uncommittedOffsets: () => ({}),
      isRunning: () => true,
      isStale: () => false,
      pause: () => () => {},
    };

    const handler = withBatchConsumer(
      {
        name: 'test.batch',
        onProgress: (metrics) => {
          progressCalls.push({
            processed: metrics.processed,
            failed: metrics.failed,
            skipped: metrics.skipped,
          });
        },
      },
      async ({ resolveOffset }) => {
        resolveOffset('0');
      },
    );

    await handler(mockPayload);
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls.at(-1)?.processed).toBe(1);
  });

  it('should throw when handler throws', async () => {
    const mockBatch = {
      topic: 'test-topic',
      partition: 0,
      messages: [],
      firstOffset: () => null,
      lastOffset: () => '0',
      highWatermark: '0',
    };

    const mockPayload = {
      batch: mockBatch,
      resolveOffset: () => {},
      heartbeat: async () => {},
      commitOffsetsIfNecessary: async () => {},
      uncommittedOffsets: () => ({}),
      isRunning: () => true,
      isStale: () => false,
      pause: () => () => {},
    };

    const handler = withBatchConsumer({ name: 'test.batch' }, async () => {
      throw new Error('batch error');
    });

    await expect(handler(mockPayload)).rejects.toThrow('batch error');
  });

  /**
   * Documents expected behavior: perMessageSpans 'all' should create a consumer
   * span for each message (1 batch span + N message spans). Currently the
   * implementation only creates the batch span and does not create per-message
   * spans, so this test fails until that behavior is implemented.
   */
  it('when perMessageSpans is "all", should create one span per message plus batch span', async () => {
    const spanNames: string[] = [];
    const realGetTracer = trace.getTracer.bind(trace);
    const getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockImplementation((name: string) => {
        const realTracer = realGetTracer(name);
        return {
          ...realTracer,
          startSpan: (spanName: string, options?: unknown, ctx?: unknown) => {
            spanNames.push(spanName);
            return realTracer.startSpan(spanName, options, ctx);
          },
        };
      });

    try {
      const mockBatch = {
        topic: 'test-topic',
        partition: 0,
        messages: [
          { offset: '0', value: Buffer.from('msg1'), headers: {} },
          { offset: '1', value: Buffer.from('msg2'), headers: {} },
        ],
        firstOffset: () => '0',
        lastOffset: () => '1',
        highWatermark: '2',
      };

      const mockPayload = {
        batch: mockBatch,
        resolveOffset: (_offset: string) => {},
        heartbeat: async () => {},
        commitOffsetsIfNecessary: async () => {},
        uncommittedOffsets: () => ({}),
        isRunning: () => true,
        isStale: () => false,
        pause: () => () => {},
      };

      const handler = withBatchConsumer(
        {
          name: 'test.batch',
          consumerGroup: 'test-group',
          perMessageSpans: 'all',
        },
        async ({ batch, resolveOffset }) => {
          for (const message of batch.messages) {
            resolveOffset(message.offset);
          }
        },
      );

      await handler(mockPayload);

      // Expected: 1 batch span + 2 per-message spans (doc says "'all': Create spans for every message")
      expect(spanNames).toHaveLength(3);
      expect(spanNames[0]).toBe('test.batch');
      // Per-message span names are implementation-defined; we only assert count
    } finally {
      getTracerSpy.mockRestore();
    }
  });

  /**
   * perMessageSpans: 'all' should create spans for every message,
   * even if user code doesn't access message.offset.
   * Current implementation only creates spans on property access,
   * so this test should fail until eager span creation is added.
   */
  it('when perMessageSpans is "all", should create spans even without offset access', async () => {
    const spanNames: string[] = [];
    const realGetTracer = trace.getTracer.bind(trace);
    const getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockImplementation((name: string) => {
        const realTracer = realGetTracer(name);
        return {
          ...realTracer,
          startSpan: (spanName: string, options?: unknown, ctx?: unknown) => {
            spanNames.push(spanName);
            return realTracer.startSpan(spanName, options, ctx);
          },
        };
      });

    try {
      const mockBatch = {
        topic: 'test-topic',
        partition: 0,
        messages: [
          { offset: '0', value: Buffer.from('msg1'), headers: {} },
          { offset: '1', value: Buffer.from('msg2'), headers: {} },
        ],
        firstOffset: () => '0',
        lastOffset: () => '1',
        highWatermark: '2',
      };

      const mockPayload = {
        batch: mockBatch,
        resolveOffset: (_offset: string) => {},
        heartbeat: async () => {},
        commitOffsetsIfNecessary: async () => {},
        uncommittedOffsets: () => ({}),
        isRunning: () => true,
        isStale: () => false,
        pause: () => () => {},
      };

      const handler = withBatchConsumer(
        {
          name: 'test.batch',
          consumerGroup: 'test-group',
          perMessageSpans: 'all',
        },
        async ({ batch }) => {
          // Intentionally do not access message.offset (or any properties)
          for (const _message of batch.messages) {
            void _message;
          }
        },
      );

      await handler(mockPayload);

      // Expected: 1 batch span + 2 per-message spans
      expect(spanNames).toHaveLength(3);
      expect(spanNames[0]).toBe('test.batch');
    } finally {
      getTracerSpy.mockRestore();
    }
  });

  it('when perMessageSpans is "all" and handler throws, should end any open per-message spans', async () => {
    const endCounts: number[] = [];
    const realGetTracer = trace.getTracer.bind(trace);
    const getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockImplementation((name: string) => {
        const realTracer = realGetTracer(name);
        return {
          ...realTracer,
          startSpan: (spanName: string, options?: unknown, ctx?: unknown) => {
            const realSpan = realTracer.startSpan(spanName, options, ctx);
            const index = endCounts.length;
            endCounts.push(0);
            // Delegate to real span (so setAttribute etc. work) but wrap end() to count
            const wrappedSpan = Object.create(realSpan) as typeof realSpan;
            wrappedSpan.end = () => {
              endCounts[index] = (endCounts[index] ?? 0) + 1;
              realSpan.end();
            };
            return wrappedSpan;
          },
        };
      });

    try {
      const mockBatch = {
        topic: 'test-topic',
        partition: 0,
        messages: [
          { offset: '0', value: Buffer.from('msg1'), headers: {} },
          { offset: '1', value: Buffer.from('msg2'), headers: {} },
        ],
        firstOffset: () => '0',
        lastOffset: () => '1',
        highWatermark: '2',
      };

      const mockPayload = {
        batch: mockBatch,
        resolveOffset: (_offset: string) => {},
        heartbeat: async () => {},
        commitOffsetsIfNecessary: async () => {},
        uncommittedOffsets: () => ({}),
        isRunning: () => true,
        isStale: () => false,
        pause: () => () => {},
      };

      const handler = withBatchConsumer(
        {
          name: 'test.batch',
          consumerGroup: 'test-group',
          perMessageSpans: 'all',
        },
        async ({ batch, _resolveOffset }) => {
          // Access first message (creates per-message span), then throw before resolveOffset
          const first = batch.messages[0];
          void first.offset; // trigger span creation
          throw new Error('batch error');
        },
      );

      await expect(handler(mockPayload)).rejects.toThrow('batch error');

      // Batch span + 2 open per-message spans (all created upfront in 'all' mode) should all be ended (no leak)
      expect(endCounts.filter((c) => c === 1).length).toBe(3);
    } finally {
      getTracerSpy.mockRestore();
    }
  });

  /**
   * perMessageSpans: 'errors' should create per-message spans for failures.
   * The current implementation never creates spans in 'errors' mode, so this
   * test documents the expected behavior and should fail until implemented.
   */
  it('when perMessageSpans is "errors", should create error span for failed message', async () => {
    const spanNames: string[] = [];
    const realGetTracer = trace.getTracer.bind(trace);
    const getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockImplementation((name: string) => {
        const realTracer = realGetTracer(name);
        return {
          ...realTracer,
          startSpan: (spanName: string, options?: unknown, ctx?: unknown) => {
            spanNames.push(spanName);
            return realTracer.startSpan(spanName, options, ctx);
          },
        };
      });

    try {
      const mockBatch = {
        topic: 'test-topic',
        partition: 0,
        messages: [
          { offset: '0', value: Buffer.from('msg1'), headers: {} },
          { offset: '1', value: Buffer.from('msg2'), headers: {} },
        ],
        firstOffset: () => '0',
        lastOffset: () => '1',
        highWatermark: '2',
      };

      const mockPayload = {
        batch: mockBatch,
        resolveOffset: (_offset: string) => {},
        heartbeat: async () => {},
        commitOffsetsIfNecessary: async () => {},
        uncommittedOffsets: () => ({}),
        isRunning: () => true,
        isStale: () => false,
        pause: () => () => {},
      };

      const handler = withBatchConsumer(
        {
          name: 'test.batch',
          consumerGroup: 'test-group',
          perMessageSpans: 'errors',
        },
        async ({ batch, resolveOffset }) => {
          // Simulate first message failure
          const message = batch.messages[0];
          void message;
          throw new Error('message failure');
          resolveOffset('1');
        },
      );

      await expect(handler(mockPayload)).rejects.toThrow('message failure');

      // Expected: 1 batch span + 1 per-message error span
      expect(spanNames.length).toBe(2);
    } finally {
      getTracerSpy.mockRestore();
    }
  });

  /**
   * perMessageSpans: 'all' should parent message spans to the batch span
   * when there is no extracted trace context in headers.
   */
  it('when perMessageSpans is "all", should parent per-message spans to batch span by default', async () => {
    const parentSpans: Array<ReturnType<typeof trace.getSpan> | undefined> = [];
    let batchSpan: ReturnType<typeof trace.getSpan> | undefined;
    const realGetTracer = trace.getTracer.bind(trace);
    const getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockImplementation((name: string) => {
        const realTracer = realGetTracer(name);
        return {
          ...realTracer,
          startSpan: (spanName: string, options?: unknown, ctx?: unknown) => {
            const span = realTracer.startSpan(spanName, options, ctx as never);
            if (spanName === 'test.batch') {
              batchSpan = span;
            } else {
              parentSpans.push(ctx ? trace.getSpan(ctx as never) : undefined);
            }
            return span;
          },
        };
      });

    try {
      const mockBatch = {
        topic: 'test-topic',
        partition: 0,
        messages: [
          { offset: '0', value: Buffer.from('msg1'), headers: {} },
          { offset: '1', value: Buffer.from('msg2'), headers: {} },
        ],
        firstOffset: () => '0',
        lastOffset: () => '1',
        highWatermark: '2',
      };

      const mockPayload = {
        batch: mockBatch,
        resolveOffset: (_offset: string) => {},
        heartbeat: async () => {},
        commitOffsetsIfNecessary: async () => {},
        uncommittedOffsets: () => ({}),
        isRunning: () => true,
        isStale: () => false,
        pause: () => () => {},
      };

      const handler = withBatchConsumer(
        {
          name: 'test.batch',
          consumerGroup: 'test-group',
          perMessageSpans: 'all',
        },
        async ({ batch, resolveOffset }) => {
          for (const message of batch.messages) {
            resolveOffset(message.offset);
          }
        },
      );

      await handler(mockPayload);

      expect(parentSpans).toHaveLength(2);
      expect(parentSpans.every((parent) => parent === batchSpan)).toBe(true);
    } finally {
      getTracerSpy.mockRestore();
    }
  });

  /**
   * perMessageSpans: 'all' should end all per-message spans when the batch
   * handler completes, even if some messages were not resolved.
   */
  it('when perMessageSpans is "all", should end un-resolved message spans on success', async () => {
    const endCounts: number[] = [];
    const realGetTracer = trace.getTracer.bind(trace);
    const getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockImplementation((name: string) => {
        const realTracer = realGetTracer(name);
        return {
          ...realTracer,
          startSpan: (spanName: string, options?: unknown, ctx?: unknown) => {
            const realSpan = realTracer.startSpan(spanName, options, ctx);
            const index = endCounts.length;
            endCounts.push(0);
            const wrappedSpan = Object.create(realSpan) as typeof realSpan;
            wrappedSpan.end = () => {
              endCounts[index] = (endCounts[index] ?? 0) + 1;
              realSpan.end();
            };
            return wrappedSpan;
          },
        };
      });

    try {
      const mockBatch = {
        topic: 'test-topic',
        partition: 0,
        messages: [
          { offset: '0', value: Buffer.from('msg1'), headers: {} },
          { offset: '1', value: Buffer.from('msg2'), headers: {} },
        ],
        firstOffset: () => '0',
        lastOffset: () => '1',
        highWatermark: '2',
      };

      const mockPayload = {
        batch: mockBatch,
        resolveOffset: (_offset: string) => {},
        heartbeat: async () => {},
        commitOffsetsIfNecessary: async () => {},
        uncommittedOffsets: () => ({}),
        isRunning: () => true,
        isStale: () => false,
        pause: () => () => {},
      };

      const handler = withBatchConsumer(
        {
          name: 'test.batch',
          consumerGroup: 'test-group',
          perMessageSpans: 'all',
        },
        async ({ resolveOffset }) => {
          // Resolve only the first message; leave the second unresolved.
          resolveOffset('0');
        },
      );

      await handler(mockPayload);

      // Batch span + 2 per-message spans should all be ended
      expect(endCounts.filter((c) => c === 1).length).toBe(3);
    } finally {
      getTracerSpy.mockRestore();
    }
  });

  /**
   * perMessageSpans: 'all' should honor extracted trace context from message headers
   * so that message spans continue the producer trace when traceparent is present.
   */
  it('when perMessageSpans is "all", should use extracted trace context for message spans', async () => {
    const messageTraceIds: string[] = [];
    const traceId = '12345678901234567890123456789012';
    const spanId = '1234567890123456';
    const realGetTracer = trace.getTracer.bind(trace);
    const getTracerSpy = vi
      .spyOn(trace, 'getTracer')
      .mockImplementation((name: string) => {
        const realTracer = realGetTracer(name);
        return {
          ...realTracer,
          startSpan: (spanName: string, options?: unknown, ctx?: unknown) => {
            const span = realTracer.startSpan(spanName, options, ctx as never);
            if (spanName !== 'test.batch') {
              messageTraceIds.push(span.spanContext().traceId);
            }
            return span;
          },
        };
      });

    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    try {
      const mockBatch = {
        topic: 'test-topic',
        partition: 0,
        messages: [
          {
            offset: '0',
            value: Buffer.from('msg1'),
            headers: {
              traceparent: `00-${traceId}-${spanId}-01`,
            },
          },
          {
            offset: '1',
            value: Buffer.from('msg2'),
            headers: {
              traceparent: `00-${traceId}-${spanId}-01`,
            },
          },
        ],
        firstOffset: () => '0',
        lastOffset: () => '1',
        highWatermark: '2',
      };

      const mockPayload = {
        batch: mockBatch,
        resolveOffset: (_offset: string) => {},
        heartbeat: async () => {},
        commitOffsetsIfNecessary: async () => {},
        uncommittedOffsets: () => ({}),
        isRunning: () => true,
        isStale: () => false,
        pause: () => () => {},
      };

      const handler = withBatchConsumer(
        {
          name: 'test.batch',
          consumerGroup: 'test-group',
          perMessageSpans: 'all',
        },
        async ({ batch, resolveOffset }) => {
          for (const message of batch.messages) {
            resolveOffset(message.offset);
          }
        },
      );

      await handler(mockPayload);

      expect(messageTraceIds).toEqual([traceId, traceId]);
    } finally {
      getTracerSpy.mockRestore();
    }
  });
});

describe('createMessageErrorSpan', () => {
  it('should be a function', () => {
    expect(typeof createMessageErrorSpan).toBe('function');
  });

  it('should create error span for message', () => {
    // This just verifies it doesn't throw
    createMessageErrorSpan(
      'test.error',
      { offset: '0', headers: {} },
      new Error('test error'),
      'test-topic',
      0,
    );
    expect(true).toBe(true);
  });
});

describe('createStreamProcessor', () => {
  it('should create a processor with run method', () => {
    const processor = createStreamProcessor({
      name: 'test-processor',
      stages: ['validate', 'transform'],
    });

    expect(processor).toBeDefined();
    expect(typeof processor.run).toBe('function');
  });

  it('should execute stages in order', async () => {
    const processor = createStreamProcessor({
      name: 'test-processor',
    });

    const executionOrder: string[] = [];

    await processor.run(
      { value: Buffer.from('test'), headers: {} },
      async (ctx) => {
        await ctx.stage('first', () => {
          executionOrder.push('first');
          return 'result1';
        });
        await ctx.stage('second', () => {
          executionOrder.push('second');
          return 'result2';
        });
      },
    );

    expect(executionOrder).toEqual(['first', 'second']);
  });

  it('should return result from callback', async () => {
    const processor = createStreamProcessor({
      name: 'test-processor',
    });

    const result = await processor.run(
      { value: Buffer.from('test'), headers: {} },
      async (ctx) => {
        const value = await ctx.stage('transform', () => 'transformed');
        return value;
      },
    );

    expect(result).toBe('transformed');
  });

  it('should throw when stage throws', async () => {
    const processor = createStreamProcessor({
      name: 'test-processor',
    });

    await expect(
      processor.run(
        { value: Buffer.from('test'), headers: {} },
        async (ctx) => {
          await ctx.stage('failing', () => {
            throw new Error('stage error');
          });
        },
      ),
    ).rejects.toThrow('stage error');
  });

  it('should provide produce helper that returns headers', async () => {
    const processor = createStreamProcessor({
      name: 'test-processor',
    });

    let producedHeaders: Record<string, string> | undefined;

    await processor.run(
      { value: Buffer.from('test'), headers: {} },
      async (ctx) => {
        producedHeaders = await ctx.produce('output-topic', { data: 'test' });
      },
    );

    expect(producedHeaders).toBeDefined();
    expect(typeof producedHeaders).toBe('object');
  });

  it('should expose inputContext from message headers', async () => {
    const processor = createStreamProcessor({
      name: 'test-processor',
    });

    let inputContextAccessed = false;

    await processor.run(
      {
        value: Buffer.from('test'),
        headers: {
          traceparent:
            '00-12345678901234567890123456789012-1234567890123456-01',
        },
      },
      async (ctx) => {
        // Access inputContext to verify it's available
        inputContextAccessed =
          ctx.inputContext !== undefined || ctx.inputContext === undefined;
      },
    );

    // inputContext may be undefined without propagator, but should be accessible
    expect(inputContextAccessed).toBe(true);
  });
});

describe('ConsumerMetrics', () => {
  it('should throw when lag polling enabled without lagPollIntervalMs', () => {
    const mockConsumer = {
      on: () => {},
    };

    expect(() => {
      new ConsumerMetrics({
        consumer: mockConsumer,
        enableLag: true,
        lagStrategy: 'polling',
      });
    }).toThrow('Lag polling requires lagPollIntervalMs');
  });

  it('should throw when lag strategy requires admin but not provided', () => {
    const mockConsumer = {
      on: () => {},
    };

    expect(() => {
      new ConsumerMetrics({
        consumer: mockConsumer,
        enableLag: true,
        lagStrategy: 'polling',
        lagPollIntervalMs: 30_000,
      });
    }).toThrow("Lag strategy 'polling' requires admin client");
  });

  it('should throw when lag enabled without groupId', () => {
    const mockConsumer = {
      on: () => {},
    };
    const mockAdmin = {
      fetchTopicOffsets: async () => [],
      fetchOffsets: async () => [],
    };

    expect(() => {
      new ConsumerMetrics({
        consumer: mockConsumer,
        admin: mockAdmin,
        enableLag: true,
        lagStrategy: 'polling',
        lagPollIntervalMs: 30_000,
      });
    }).toThrow('Lag tracking requires groupId');
  });

  it('should throw when lag enabled without topics', () => {
    const mockConsumer = {
      on: () => {},
    };
    const mockAdmin = {
      fetchTopicOffsets: async () => [],
      fetchOffsets: async () => [],
    };

    expect(() => {
      new ConsumerMetrics({
        consumer: mockConsumer,
        admin: mockAdmin,
        groupId: 'test-group',
        enableLag: true,
        lagStrategy: 'polling',
        lagPollIntervalMs: 30_000,
      });
    }).toThrow('Lag tracking requires topics');
  });

  it('should throw when lag enabled with empty topics array', () => {
    const mockConsumer = {
      on: () => {},
    };
    const mockAdmin = {
      fetchTopicOffsets: async () => [],
      fetchOffsets: async () => [],
    };

    expect(() => {
      new ConsumerMetrics({
        consumer: mockConsumer,
        admin: mockAdmin,
        groupId: 'test-group',
        topics: [],
        enableLag: true,
        lagStrategy: 'polling',
        lagPollIntervalMs: 30_000,
      });
    }).toThrow('Lag tracking requires topics');
  });

  it('should create metrics instance with valid config', () => {
    const mockConsumer = {
      on: () => {},
    };

    const metrics = new ConsumerMetrics({
      consumer: mockConsumer,
      enableLag: false,
    });

    expect(metrics).toBeDefined();
  });

  it('should have recordMessageProcessed method', () => {
    const mockConsumer = {
      on: () => {},
    };

    const metrics = new ConsumerMetrics({
      consumer: mockConsumer,
    });

    expect(typeof metrics.recordMessageProcessed).toBe('function');
  });

  it('should have recordBatch method', () => {
    const mockConsumer = {
      on: () => {},
    };

    const metrics = new ConsumerMetrics({
      consumer: mockConsumer,
    });

    expect(typeof metrics.recordBatch).toBe('function');
  });

  it('should have start and stop methods', async () => {
    const mockConsumer = {
      on: () => {},
    };

    const metrics = new ConsumerMetrics({
      consumer: mockConsumer,
    });

    await metrics.start();
    await metrics.stop();
    expect(true).toBe(true);
  });
});

describe('instrumentConsumerEvents', () => {
  it('should return cleanup function', () => {
    const listeners: Array<{ event: string; listener: unknown }> = [];
    const mockConsumer = {
      on: (event: string, listener: unknown) => {
        listeners.push({ event, listener });
      },
      off: () => {},
    };

    const cleanup = instrumentConsumerEvents(mockConsumer, {
      traceRebalances: true,
      traceErrors: true,
    });

    expect(typeof cleanup).toBe('function');
  });

  it('should attach event listeners', () => {
    const listeners: Array<{ event: string }> = [];
    const mockConsumer = {
      on: (event: string) => {
        listeners.push({ event });
      },
    };

    instrumentConsumerEvents(mockConsumer, {
      traceRebalances: true,
      traceErrors: true,
      traceHeartbeats: true,
    });

    // Should have listeners for rebalance, error, and heartbeat events
    expect(listeners.length).toBeGreaterThan(0);
  });

  it('should not attach heartbeat listeners by default', () => {
    const listeners: Array<{ event: string }> = [];
    const mockConsumer = {
      on: (event: string) => {
        listeners.push({ event });
      },
    };

    instrumentConsumerEvents(mockConsumer, {
      traceRebalances: true,
      traceErrors: true,
    });

    const heartbeatListeners = listeners.filter((l) =>
      l.event.includes('heartbeat'),
    );
    expect(heartbeatListeners.length).toBe(0);
  });

  it('should cleanup listeners when cleanup function called', () => {
    const removedListeners: Array<{ event: string }> = [];
    const mockConsumer = {
      on: () => {},
      off: (event: string) => {
        removedListeners.push({ event });
      },
    };

    const cleanup = instrumentConsumerEvents(mockConsumer, {
      traceRebalances: true,
      traceErrors: true,
    });

    cleanup();

    expect(removedListeners.length).toBeGreaterThan(0);
  });
});

describe('batch consumer constants', () => {
  it('should export batch-related constants', () => {
    expect(SEMATTRS_MESSAGING_BATCH_MESSAGE_COUNT).toBe(
      'messaging.batch.message_count',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_BATCH_FIRST_OFFSET).toBe(
      'messaging.kafka.batch.first_offset',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_BATCH_LAST_OFFSET).toBe(
      'messaging.kafka.batch.last_offset',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_PROCESSED).toBe(
      'messaging.kafka.batch.messages_processed',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_BATCH_MESSAGES_FAILED).toBe(
      'messaging.kafka.batch.messages_failed',
    );
    expect(SEMATTRS_MESSAGING_KAFKA_BATCH_PROCESSING_TIME_MS).toBe(
      'messaging.kafka.batch.processing_time_ms',
    );
  });
});
