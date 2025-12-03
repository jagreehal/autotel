import { describe, it, expect } from 'vitest';
import { createMockRequest, generateTraceparent } from './testing';

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
