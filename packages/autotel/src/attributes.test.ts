import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTraceCollector, TraceCollector } from './testing';
import { trace, TraceContext } from './functional';
import {
  attrs,
  setUser,
  identify,
  httpServer,
  mergeAttrs,
  safeSetAttributes,
  transaction,
} from './attributes';

describe('attributes', () => {
  let collector: TraceCollector;

  beforeEach(() => {
    collector = createTraceCollector();
  });

  describe('Pattern A: Key builders', () => {
    it('should create user.id attribute', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        ctx.setAttributes(attrs.user.id('user-123'));
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'user.id': 'user-123',
      });
    });

    it('should create http.request.method attribute', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        ctx.setAttributes(attrs.http.request.method('GET'));
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'http.request.method': 'GET',
      });
    });

    it('should create multiple attributes from key builders', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        ctx.setAttributes(
          mergeAttrs(
            attrs.user.id('user-123'),
            attrs.http.request.method('GET'),
            attrs.session.id('session-456'),
          ),
        );
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'user.id': 'user-123',
        'http.request.method': 'GET',
        'session.id': 'session-456',
      });
    });
  });

  describe('Pattern B: Object builders', () => {
    it('should create user attributes from object', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        const userAttrs = attrs.user.data({
          id: 'user-123',
          email: 'test@example.com',
        });
        ctx.setAttributes(userAttrs);
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'user.id': 'user-123',
        'user.email': 'test@example.com',
      });
    });

    it('should create HTTP server attributes from object', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        const httpAttrs = attrs.http.server({
          method: 'POST',
          route: '/users/:id',
          statusCode: 200,
        });
        ctx.setAttributes(httpAttrs);
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'http.request.method': 'POST',
        'http.route': '/users/:id',
        'http.response.status_code': 200,
      });
    });
  });

  describe('Attachers: attachers', () => {
    it('setUser should set user attributes on span (PII redacted by default)', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        setUser(ctx, { id: 'user-123', email: 'test@example.com' });
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'user.id': 'user-123',
        'user.email': '[REDACTED]', // PII is redacted by default
      });
    });

    it('httpServer should set HTTP attributes and update span name', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        httpServer(ctx, {
          method: 'GET',
          route: '/api/users',
          statusCode: 200,
        });
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'http.request.method': 'GET',
        'http.route': '/api/users',
        'http.response.status_code': 200,
      });
      expect(spans[0]!.name).toBe('HTTP GET /api/users');
    });

    it('identify should bundle user, session, and device attributes', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        identify(ctx, {
          user: { id: 'user-123', name: 'John Doe' },
          session: { id: 'session-456' },
          device: { id: 'device-789', manufacturer: 'Apple' },
        });
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'user.id': 'user-123',
        'user.name': 'John Doe',
        'session.id': 'session-456',
        'device.id': 'device-789',
        'device.manufacturer': 'Apple',
      });
    });
  });

  describe('Domains: domains', () => {
    it('transaction should bundle request attributes', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        transaction(ctx, {
          method: 'GET',
          route: '/api/users',
          statusCode: 200,
          clientIp: '192.168.1.1',
        });
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes).toMatchObject({
        'http.request.method': 'GET',
        'http.route': '/api/users',
        'http.response.status_code': 200,
        'network.peer.address': '192.168.1.1',
      });
    });
  });

  describe('Validators: validators', () => {
    it('should redact PII attributes with default policy', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        safeSetAttributes(
          ctx,
          attrs.user.data({ email: 'sensitive@example.com' }),
          {
            guardrails: { pii: 'redact' },
          },
        );
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['user.email']).toBe('[REDACTED]');
    });

    it('should allow PII when guardrails pii is "allow"', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        safeSetAttributes(
          ctx,
          attrs.user.data({ email: 'sensitive@example.com' }),
          {
            guardrails: { pii: 'allow' },
          },
        );
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['user.email']).toBe('sensitive@example.com');
    });

    it('should hash PII when guardrails pii is "hash"', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        safeSetAttributes(
          ctx,
          attrs.user.data({ email: 'sensitive@example.com' }),
          {
            guardrails: { pii: 'hash' },
          },
        );
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['user.email']).toMatch(/^hash_[a-f0-9]+$/);
    });

    it('should log warning for deprecated attributes', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn');

      const testFn = trace((ctx: TraceContext) => async () => {
        // Use an actually deprecated attribute (http.method -> http.request.method)
        safeSetAttributes(
          ctx,
          { 'http.method': 'GET' },
          {
            guardrails: { warnDeprecated: true },
          },
        );
      });

      await testFn();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );
      consoleWarnSpy.mockRestore();
    });

    it('should truncate values exceeding maxLength', async () => {
      const testFn = trace((ctx: TraceContext) => async () => {
        safeSetAttributes(ctx, attrs.user.data({ id: 'a'.repeat(300) }), {
          guardrails: { maxLength: 255 },
        });
      });

      await testFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      const userId = spans[0]!.attributes['user.id'] as string;
      expect(userId.length).toBeLessThanOrEqual(255);
      expect(userId).toMatch(/\.\.\.$/);
    });
  });
});
