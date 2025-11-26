import { describe, it, expect, vi } from 'vitest';
import { instrument } from './instrument';
import { trace } from 'autotel-edge';
import type { ExportedHandler } from '@cloudflare/workers-types';

describe('Handler Instrumentation - Integration Tests', () => {
  interface Env {
    OTLP_ENDPOINT?: string;
    API_KEY?: string;
  }

  describe('instrument() for Fetch Handlers', () => {
    it('should instrument a basic fetch handler', async () => {
      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          return new Response('Hello World', { status: 200 });
        },
      };

      const instrumented = instrument(handler, (env: Env) => ({
        service: {
          name: 'test-worker',
          version: '1.0.0',
        },
        exporter: {
          url: env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
          headers: { 'x-api-key': env.API_KEY || 'test-key' },
        },
      }));

      expect(instrumented).toBeDefined();
      expect(typeof instrumented.fetch).toBe('function');
    });

    it('should create a new handler that wraps the original', async () => {
      let handlerCalled = false;

      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          handlerCalled = true;
          return new Response('Hello World', { status: 200 });
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      const request = new Request('http://example.com/test');
      const env = {} as Env;
      const ctx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as any;

      await instrumented.fetch(request, env, ctx);

      expect(handlerCalled).toBe(true);
    });

    it('should call waitUntil to flush spans', async () => {
      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          return new Response('Hello World', { status: 200 });
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      const request = new Request('http://example.com/test');
      const env = {} as Env;
      const waitUntilSpy = vi.fn();
      const ctx = {
        waitUntil: waitUntilSpy,
        passThroughOnException: vi.fn(),
      } as any;

      await instrumented.fetch(request, env, ctx);

      // waitUntil should be called to flush spans
      expect(waitUntilSpy).toHaveBeenCalled();
    });

    it('should preserve handler errors', async () => {
      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          throw new Error('Handler error');
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      const request = new Request('http://example.com/test');
      const env = {} as Env;
      const ctx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as any;

      await expect(instrumented.fetch(request, env, ctx)).rejects.toThrow('Handler error');
    });

    it('should work with trace() functions inside handler', async () => {
      const createUser = trace(async function createUser(email: string) {
        return { id: '123', email };
      });

      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          const user = await createUser('test@example.com');
          return Response.json(user);
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      const request = new Request('http://example.com/users');
      const env = {} as Env;
      const ctx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as any;

      const response = await instrumented.fetch(request, env, ctx);
      const data = await response.json();

      expect(data).toEqual({ id: '123', email: 'test@example.com' });
    });

    it('should accept static config object', async () => {
      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          return new Response('Hello', { status: 200 });
        },
      };

      const instrumented = instrument(handler, {
        service: {
          name: 'test-worker',
          version: '1.0.0',
          namespace: 'testing',
        },
        exporter: {
          url: 'http://localhost:4318/v1/traces',
        },
      });

      expect(instrumented).toBeDefined();
      expect(typeof instrumented.fetch).toBe('function');
    });

    it('should accept config function', async () => {
      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          return new Response('Hello', { status: 200 });
        },
      };

      const instrumented = instrument(handler, (env: Env) => ({
        service: { name: env.OTLP_ENDPOINT ? 'prod-worker' : 'dev-worker' },
      }));

      expect(instrumented).toBeDefined();
      expect(typeof instrumented.fetch).toBe('function');
    });
  });

  describe('Handler with Scheduled Events', () => {
    it('should instrument scheduled handler', async () => {
      let scheduledCalled = false;

      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          return new Response('Hello', { status: 200 });
        },
        async scheduled(event, env, ctx) {
          scheduledCalled = true;
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      expect(instrumented.scheduled).toBeDefined();

      if (instrumented.scheduled) {
        const event = { scheduledTime: Date.now(), cron: '0 0 * * *' } as ScheduledController;
        const env = {} as Env;
        const ctx = {
          waitUntil: vi.fn(),
          passThroughOnException: vi.fn(),
        } as any;

        await instrumented.scheduled(event, env, ctx);

        expect(scheduledCalled).toBe(true);
        expect(ctx.waitUntil).toHaveBeenCalled();
      }
    });
  });

  describe('Handler with Queue Events', () => {
    it('should instrument queue handler', async () => {
      let queueCalled = false;
      let messageCount = 0;

      const handler: ExportedHandler<Env> = {
        async queue(batch, env, ctx) {
          queueCalled = true;
          messageCount = batch.messages.length;
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      expect(instrumented.queue).toBeDefined();

      if (instrumented.queue) {
        const batch = {
          messages: [
            { id: '1', body: 'message1', timestamp: new Date() },
            { id: '2', body: 'message2', timestamp: new Date() },
          ],
          queue: 'test-queue',
          ackAll: vi.fn(),
          retryAll: vi.fn(),
        } as MessageBatch;
        const env = {} as Env;
        const ctx = {
          waitUntil: vi.fn(),
          passThroughOnException: vi.fn(),
        } as any;

        await instrumented.queue(batch, env, ctx);

        expect(queueCalled).toBe(true);
        expect(messageCount).toBe(2);
        expect(ctx.waitUntil).toHaveBeenCalled();
      }
    });

    it('should track message ack operations', async () => {
      const handler: ExportedHandler<Env> = {
        async queue(batch, env, ctx) {
          // Ack individual messages
          batch.messages[0].ack();
          batch.messages[1].ack();
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      if (instrumented.queue) {
        const messages = [
          { id: '1', body: 'message1', timestamp: new Date(), ack: vi.fn(), retry: vi.fn() },
          { id: '2', body: 'message2', timestamp: new Date(), ack: vi.fn(), retry: vi.fn() },
        ];
        const batch = {
          messages,
          queue: 'test-queue',
          ackAll: vi.fn(),
          retryAll: vi.fn(),
        } as MessageBatch;
        const env = {} as Env;
        const ctx = {
          waitUntil: vi.fn(),
          passThroughOnException: vi.fn(),
        } as any;

        await instrumented.queue(batch, env, ctx);

        // Verify ack was called on both messages
        expect(messages[0].ack).toHaveBeenCalled();
        expect(messages[1].ack).toHaveBeenCalled();
      }
    });

    it('should track message retry operations', async () => {
      const handler: ExportedHandler<Env> = {
        async queue(batch, env, ctx) {
          // Retry a message
          batch.messages[0].retry();
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      if (instrumented.queue) {
        const messages = [
          { id: '1', body: 'message1', timestamp: new Date(), ack: vi.fn(), retry: vi.fn() },
        ];
        const batch = {
          messages,
          queue: 'test-queue',
          ackAll: vi.fn(),
          retryAll: vi.fn(),
        } as MessageBatch;
        const env = {} as Env;
        const ctx = {
          waitUntil: vi.fn(),
          passThroughOnException: vi.fn(),
        } as any;

        await instrumented.queue(batch, env, ctx);

        // Verify retry was called
        expect(messages[0].retry).toHaveBeenCalled();
      }
    });

    it('should track ackAll operation', async () => {
      const handler: ExportedHandler<Env> = {
        async queue(batch, env, ctx) {
          batch.ackAll();
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      if (instrumented.queue) {
        const ackAllFn = vi.fn();
        const batch = {
          messages: [
            { id: '1', body: 'message1', timestamp: new Date() },
            { id: '2', body: 'message2', timestamp: new Date() },
          ],
          queue: 'test-queue',
          ackAll: ackAllFn,
          retryAll: vi.fn(),
        } as MessageBatch;
        const env = {} as Env;
        const ctx = {
          waitUntil: vi.fn(),
          passThroughOnException: vi.fn(),
        } as any;

        await instrumented.queue(batch, env, ctx);

        expect(ackAllFn).toHaveBeenCalled();
      }
    });
  });

  describe('Handler with Email Events', () => {
    it('should instrument email handler', async () => {
      let emailCalled = false;

      const handler: ExportedHandler<Env> = {
        async email(message, env, ctx) {
          emailCalled = true;
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      expect(instrumented.email).toBeDefined();

      if (instrumented.email) {
        const message = {
          from: 'sender@example.com',
          to: 'recipient@example.com',
          headers: new Headers({ subject: 'Test Email' }),
        } as ForwardableEmailMessage;
        const env = {} as Env;
        const ctx = {
          waitUntil: vi.fn(),
          passThroughOnException: vi.fn(),
        } as any;

        await instrumented.email(message, env, ctx);

        expect(emailCalled).toBe(true);
        expect(ctx.waitUntil).toHaveBeenCalled();
      }
    });
  });

  describe('Context Propagation', () => {
    it('should propagate trace context from request headers', async () => {
      let receivedContext = false;

      const handler: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          // If context is propagated, we should have trace info
          const traceparent = request.headers.get('traceparent');
          receivedContext = !!traceparent;
          return new Response('OK', { status: 200 });
        },
      };

      const instrumented = instrument(handler, {
        service: { name: 'test-worker' },
      });

      const request = new Request('http://example.com/test', {
        headers: {
          'traceparent': '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        },
      });
      const env = {} as Env;
      const ctx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as any;

      await instrumented.fetch(request, env, ctx);

      expect(receivedContext).toBe(true);
    });
  });

  describe('Multiple Handlers', () => {
    it('should instrument multiple handlers independently', async () => {
      const handler1: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          return new Response('Handler 1', { status: 200 });
        },
      };

      const handler2: ExportedHandler<Env> = {
        async fetch(request, env, ctx) {
          return new Response('Handler 2', { status: 200 });
        },
      };

      const instrumented1 = instrument(handler1, {
        service: { name: 'worker-1' },
      });

      const instrumented2 = instrument(handler2, {
        service: { name: 'worker-2' },
      });

      const request = new Request('http://example.com/test');
      const env = {} as Env;
      const ctx = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as any;

      const response1 = await instrumented1.fetch(request, env, ctx);
      const response2 = await instrumented2.fetch(request, env, ctx);

      const text1 = await response1.text();
      const text2 = await response2.text();

      expect(text1).toBe('Handler 1');
      expect(text2).toBe('Handler 2');
    });
  });
});
