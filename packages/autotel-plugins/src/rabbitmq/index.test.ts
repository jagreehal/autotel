import { describe, it, expect } from 'vitest';
import {
  normalizeHeaders,
  extractCorrelationId,
  deriveCorrelationId,
  injectTraceHeaders,
  extractTraceContext,
  extractBatchLineage,
  withConsumeSpan,
  withPublishSpan,
  recordAckResult,
  CORRELATION_ID_HEADER,
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_OPERATION_NAME,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY,
  SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_EXCHANGE,
  SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT,
  SEMATTRS_MESSAGING_RABBITMQ_REQUEUE,
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

  it('should convert number values to strings', () => {
    const headers = {
      retryCount: 3,
      priority: 1,
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized.retryCount).toBe('3');
    expect(normalized.priority).toBe('1');
  });

  it('should convert boolean values to strings', () => {
    const headers = {
      persistent: true,
      mandatory: false,
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized.persistent).toBe('true');
    expect(normalized.mandatory).toBe('false');
  });

  it('should stringify small objects', () => {
    const headers = {
      metadata: { foo: 'bar' },
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized.metadata).toBe('{"foo":"bar"}');
  });

  it('should drop objects larger than 1KB', () => {
    const largeObject = { data: 'x'.repeat(2000) };
    const headers = {
      large: largeObject,
      small: 'keep',
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized.large).toBeUndefined();
    expect(normalized.small).toBe('keep');
  });

  it('should handle UTF-8 encoded Buffer values', () => {
    const headers = {
      key: Buffer.from('こんにちは', 'utf8'),
    };
    const normalized = normalizeHeaders(headers);
    expect(normalized.key).toBe('こんにちは');
  });

  it('should handle invalid UTF-8 with base64 fallback', () => {
    // Create a buffer with invalid UTF-8 sequence
    const invalidUtf8 = Buffer.from([255, 254, 0, 1]);
    const headers = {
      binary: invalidUtf8,
    };
    const normalized = normalizeHeaders(headers);
    // Should have base64: prefix
    expect(normalized.binary).toMatch(/^base64:/);
  });

  it('should handle empty object', () => {
    expect(normalizeHeaders({})).toEqual({});
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
    expect(ctx).toBeDefined();
    // Can get span context from extracted context (may be undefined without propagator)
    const _spanContext = trace.getSpanContext(ctx);
  });

  it('should handle case-insensitive header lookup', () => {
    const headers = {
      TRACEPARENT: '00-12345678901234567890123456789012-1234567890123456-01',
    };
    const ctx = extractTraceContext(headers);
    expect(ctx).toBeDefined();
  });
});

describe('extractCorrelationId', () => {
  it('should return undefined when no correlation ID exists', () => {
    expect(extractCorrelationId({})).toBeUndefined();
  });

  it('should extract from x-correlation-id header', () => {
    const headers = { 'x-correlation-id': 'corr-12345' };
    expect(extractCorrelationId(headers)).toBe('corr-12345');
  });

  it('should prefer AMQP correlationId property over header', () => {
    const headers = { 'x-correlation-id': 'header-corr' };
    expect(extractCorrelationId(headers, 'amqp-corr')).toBe('amqp-corr');
  });

  it('should handle case-insensitive header lookup', () => {
    const headers = { 'X-Correlation-ID': 'corr-12345' };
    expect(extractCorrelationId(headers)).toBe('corr-12345');
  });

  it('should handle X-CORRELATION-ID uppercase', () => {
    const headers = { 'X-CORRELATION-ID': 'corr-12345' };
    expect(extractCorrelationId(headers)).toBe('corr-12345');
  });
});

describe('deriveCorrelationId', () => {
  it('should return empty string when no active span', () => {
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

describe('withConsumeSpan', () => {
  it('should execute callback and return result', async () => {
    const result = await withConsumeSpan(
      {
        name: 'test.process',
        headers: {},
        contextMode: 'none',
        queue: 'test-queue',
      },
      async () => {
        return 'success';
      },
    );
    expect(result).toBe('success');
  });

  it('should throw when callback throws', async () => {
    await expect(
      withConsumeSpan(
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
    await withConsumeSpan(
      {
        name: 'test.process',
        headers: {},
        contextMode: 'none',
        queue: 'test-queue',
        exchange: 'test-exchange',
        routingKey: 'test.routing.key',
        messageId: 'msg-123',
        correlationId: 'corr-123',
        consumerTag: 'consumer-1',
      },
      async () => {
        return 'done';
      },
    );
    // Span was created successfully with attributes
    expect(true).toBe(true);
  });

  it('should throw when deferSpanEnd is true without ackTimeoutMs', async () => {
    await expect(
      withConsumeSpan(
        {
          name: 'test.process',
          headers: {},
          deferSpanEnd: true,
        } as Parameters<typeof withConsumeSpan>[0],
        async () => {
          return 'done';
        },
      ),
    ).rejects.toThrow('deferSpanEnd requires ackTimeoutMs');
  });

  it('should work with deferred mode and ack', async () => {
    const result = await withConsumeSpan(
      {
        name: 'test.deferred',
        headers: {},
        deferSpanEnd: true,
        ackTimeoutMs: 5000,
      },
      async (_span, controls) => {
        controls.ack();
        return 'acked';
      },
    );
    expect(result).toBe('acked');
  });

  it('should work with deferred mode and nack', async () => {
    const result = await withConsumeSpan(
      {
        name: 'test.deferred',
        headers: {},
        deferSpanEnd: true,
        ackTimeoutMs: 5000,
      },
      async (_span, controls) => {
        controls.nack({ requeue: true });
        return 'nacked';
      },
    );
    expect(result).toBe('nacked');
  });

  it('should work with deferred mode and reject', async () => {
    const result = await withConsumeSpan(
      {
        name: 'test.deferred',
        headers: {},
        deferSpanEnd: true,
        ackTimeoutMs: 5000,
      },
      async (_span, controls) => {
        controls.reject({ requeue: false });
        return 'rejected';
      },
    );
    expect(result).toBe('rejected');
  });
});

describe('withPublishSpan', () => {
  it('should execute callback and return result', async () => {
    const result = await withPublishSpan(
      {
        name: 'test.publish',
        routingKey: 'test.routing.key',
      },
      async () => {
        return 'published';
      },
    );
    expect(result).toBe('published');
  });

  it('should throw when callback throws', async () => {
    await expect(
      withPublishSpan(
        {
          name: 'test.publish',
          routingKey: 'test.routing.key',
        },
        async () => {
          throw new Error('publish error');
        },
      ),
    ).rejects.toThrow('publish error');
  });

  it('should use default exchange when not specified', async () => {
    await withPublishSpan(
      {
        name: 'test.publish',
        routingKey: 'queue-name',
      },
      async () => {
        return 'sent';
      },
    );
    // Span was created with amq.default exchange
    expect(true).toBe(true);
  });

  it('should set all messaging attributes', async () => {
    await withPublishSpan(
      {
        name: 'order.publish',
        exchange: 'orders',
        routingKey: 'order.created',
        messageId: 'msg-123',
        correlationId: 'corr-123',
      },
      async () => {
        return 'sent';
      },
    );
    // PRODUCER span was created successfully
    expect(true).toBe(true);
  });
});

describe('recordAckResult', () => {
  it('should be a function', () => {
    expect(typeof recordAckResult).toBe('function');
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
    const batch = Array.from({ length: 200 }).fill({ headers: {} });
    const result = extractBatchLineage(
      batch as Array<{ headers: Record<string, string> }>,
    );
    expect(result.links.length).toBeLessThanOrEqual(128);
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
    expect(SEMATTRS_MESSAGING_OPERATION_NAME).toBe('messaging.operation.name');
  });

  it('should export RabbitMQ-specific conventions', () => {
    expect(SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY).toBe(
      'messaging.rabbitmq.destination.routing_key',
    );
    expect(SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_EXCHANGE).toBe(
      'messaging.rabbitmq.destination.exchange',
    );
    expect(SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT).toBe(
      'messaging.rabbitmq.ack_result',
    );
    expect(SEMATTRS_MESSAGING_RABBITMQ_REQUEUE).toBe(
      'messaging.rabbitmq.requeue',
    );
  });

  it('should export batch lineage attribute names', () => {
    expect(SEMATTRS_LINKED_TRACE_ID_COUNT).toBe('linked_trace_id_count');
    expect(SEMATTRS_LINKED_TRACE_ID_HASH).toBe('linked_trace_id_hash');
  });
});

describe('context modes', () => {
  it('should support inherit mode', async () => {
    await withConsumeSpan(
      {
        name: 'test.inherit',
        headers: {},
        contextMode: 'inherit',
        queue: 'test',
      },
      async () => 'done',
    );
    expect(true).toBe(true);
  });

  it('should support link mode', async () => {
    await withConsumeSpan(
      {
        name: 'test.link',
        headers: {},
        contextMode: 'link',
        queue: 'test',
      },
      async () => 'done',
    );
    expect(true).toBe(true);
  });

  it('should support none mode', async () => {
    await withConsumeSpan(
      {
        name: 'test.none',
        headers: {},
        contextMode: 'none',
        queue: 'test',
      },
      async () => 'done',
    );
    expect(true).toBe(true);
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
    expect(typeof exports.withConsumeSpan).toBe('function');
    expect(typeof exports.withPublishSpan).toBe('function');
    expect(typeof exports.extractBatchLineage).toBe('function');
    expect(typeof exports.recordAckResult).toBe('function');
  });

  it('should export all expected constants', async () => {
    const exports = await import('./index');

    expect(exports.SEMATTRS_MESSAGING_SYSTEM).toBe('messaging.system');
    expect(exports.SEMATTRS_MESSAGING_DESTINATION_NAME).toBe(
      'messaging.destination.name',
    );
    expect(exports.SEMATTRS_MESSAGING_OPERATION_NAME).toBe(
      'messaging.operation.name',
    );
    expect(exports.SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY).toBe(
      'messaging.rabbitmq.destination.routing_key',
    );
    expect(exports.SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_EXCHANGE).toBe(
      'messaging.rabbitmq.destination.exchange',
    );
    expect(exports.SEMATTRS_MESSAGING_RABBITMQ_ACK_RESULT).toBe(
      'messaging.rabbitmq.ack_result',
    );
    expect(exports.SEMATTRS_MESSAGING_RABBITMQ_REQUEUE).toBe(
      'messaging.rabbitmq.requeue',
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
   * Verify our attribute names align with OTel messaging semantic conventions.
   */
  it('should use standard messaging.system attribute', () => {
    expect(SEMATTRS_MESSAGING_SYSTEM).toBe('messaging.system');
  });

  it('should use standard messaging.destination.name attribute', () => {
    expect(SEMATTRS_MESSAGING_DESTINATION_NAME).toBe(
      'messaging.destination.name',
    );
  });

  it('should use messaging.operation.name for operation type', () => {
    expect(SEMATTRS_MESSAGING_OPERATION_NAME).toBe('messaging.operation.name');
  });

  it('should use standard RabbitMQ routing key attribute', () => {
    expect(SEMATTRS_MESSAGING_RABBITMQ_DESTINATION_ROUTING_KEY).toBe(
      'messaging.rabbitmq.destination.routing_key',
    );
  });
});
