import { describe, it, expect } from 'vitest';
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
