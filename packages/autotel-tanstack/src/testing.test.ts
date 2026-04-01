import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockRequest,
  generateTraceparent,
  createTestSpansHandlers,
  type SerializedSpan,
} from './testing';

describe('testing utilities', () => {
  describe('createMockRequest', () => {
    it('should create a GET request', () => {
      const request = createMockRequest('GET', '/api/users');

      expect(request.method).toBe('GET');
      expect(request.url).toBe('http://localhost/api/users');
    });

    it('should create a POST request', () => {
      const request = createMockRequest('POST', '/api/users', {
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(request.method).toBe('POST');
    });

    it('should include custom headers', () => {
      const request = createMockRequest('GET', '/api/users', {
        headers: { 'x-request-id': 'test-123' },
      });

      expect(request.headers.get('x-request-id')).toBe('test-123');
    });

    it('should include traceparent header', () => {
      const traceparent =
        '00-12345678901234567890123456789012-1234567890123456-01';
      const request = createMockRequest('GET', '/api/users', { traceparent });

      expect(request.headers.get('traceparent')).toBe(traceparent);
    });
  });

  describe('generateTraceparent', () => {
    it('should generate valid traceparent format', () => {
      const traceparent = generateTraceparent();

      // Format: version-traceId-spanId-flags
      const parts = traceparent.split('-');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('00'); // version
      expect(parts[1]).toHaveLength(32); // trace ID
      expect(parts[2]).toHaveLength(16); // span ID
      expect(parts[3]).toBe('01'); // sampled flag
    });

    it('should use provided trace ID', () => {
      const traceId = '12345678901234567890123456789012';
      const traceparent = generateTraceparent(traceId);

      expect(traceparent).toContain(traceId);
    });

    it('should use provided span ID', () => {
      const spanId = '1234567890123456';
      const traceparent = generateTraceparent(undefined, spanId);

      expect(traceparent).toContain(spanId);
    });

    it('should generate different values each time', () => {
      const tp1 = generateTraceparent();
      const tp2 = generateTraceparent();

      expect(tp1).not.toBe(tp2);
    });
  });
});

// Helper to read Response JSON
async function json(res: Response): Promise<unknown> {
  return res.json();
}

describe('createTestSpansHandlers', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__testSpanExporter;
    delete process.env.E2E;
  });

  it('GET returns 404 when not in E2E mode (raw Request)', async () => {
    const { GET } = createTestSpansHandlers();
    const res = GET(new Request('http://localhost/api/test-spans'));
    expect(res.status).toBe(404);
  });

  it('GET returns 404 when not in E2E mode (context object)', async () => {
    const { GET } = createTestSpansHandlers();
    const res = GET({
      request: new Request('http://localhost/api/test-spans'),
    });
    expect(res.status).toBe(404);
  });

  it('GET returns 500 when exporter not initialized', async () => {
    process.env.E2E = '1';
    const { GET } = createTestSpansHandlers();
    const res = GET(new Request('http://localhost/api/test-spans'));
    expect(res.status).toBe(500);
  });

  it('GET returns serialized spans', async () => {
    process.env.E2E = '1';
    const mockSpan = {
      name: 'sendMoney.handler',
      spanContext: () => ({ spanId: 'abc123', traceId: 'trace456' }),
      parentSpanContext: { spanId: 'parent789' },
      attributes: { 'transfer.amount': 100 },
      status: { code: 0 },
      duration: [0, 500_000_000], // 500ms in [seconds, nanoseconds]
    };
    (globalThis as Record<string, unknown>).__testSpanExporter = {
      getFinishedSpans: () => [mockSpan],
      reset: () => {},
    };

    const { GET } = createTestSpansHandlers();
    const res = GET(new Request('http://localhost/api/test-spans'));
    expect(res.status).toBe(200);
    const body = (await json(res)) as { spans: SerializedSpan[] };
    expect(body.spans).toHaveLength(1);
    expect(body.spans[0].name).toBe('sendMoney.handler');
    expect(body.spans[0].spanId).toBe('abc123');
    expect(body.spans[0].traceId).toBe('trace456');
    expect(body.spans[0].parentSpanId).toBe('parent789');
    expect(body.spans[0].attributes?.['transfer.amount']).toBe(100);
    expect(body.spans[0].durationMs).toBeCloseTo(500, 0);
  });

  it('GET omits parentSpanId when no parent', async () => {
    process.env.E2E = '1';
    const mockSpan = {
      name: 'root',
      spanContext: () => ({ spanId: 'abc123', traceId: 'trace456' }),
      parentSpanContext: undefined,
      attributes: {},
      status: { code: 0 },
      duration: [0, 0],
    };
    (globalThis as Record<string, unknown>).__testSpanExporter = {
      getFinishedSpans: () => [mockSpan],
      reset: () => {},
    };

    const { GET } = createTestSpansHandlers();
    const body = (await json(
      GET(new Request('http://localhost/api/test-spans')),
    )) as { spans: SerializedSpan[] };
    expect(body.spans[0].parentSpanId).toBeUndefined();
  });

  it('DELETE returns 404 when not in E2E mode (raw Request)', async () => {
    const { DELETE } = createTestSpansHandlers();
    const res = DELETE(
      new Request('http://localhost/api/test-spans', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
  });

  it('DELETE returns 404 when not in E2E mode (context object)', async () => {
    const { DELETE } = createTestSpansHandlers();
    const res = DELETE({
      request: new Request('http://localhost/api/test-spans', {
        method: 'DELETE',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE returns 500 when exporter not initialized', async () => {
    process.env.E2E = '1';
    const { DELETE } = createTestSpansHandlers();
    const res = DELETE(
      new Request('http://localhost/api/test-spans', { method: 'DELETE' }),
    );
    expect(res.status).toBe(500);
  });

  it('DELETE resets exporter and returns ok', async () => {
    process.env.E2E = '1';
    const reset = vi.fn();
    (globalThis as Record<string, unknown>).__testSpanExporter = {
      getFinishedSpans: () => [],
      reset,
    };

    const { DELETE } = createTestSpansHandlers();
    const res = DELETE(
      new Request('http://localhost/api/test-spans', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect(reset).toHaveBeenCalledOnce();
    const body = (await json(res)) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
