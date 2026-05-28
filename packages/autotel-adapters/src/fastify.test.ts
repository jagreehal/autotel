import { describe, expect, it, vi } from 'vitest';
import { useLogger, withAutotel } from './fastify';
import type { FastifyRequestLike, FastifyReplyLike } from './fastify';

const req = (over: Partial<FastifyRequestLike> = {}): FastifyRequestLike => ({
  method: 'GET',
  url: '/api/orders',
  routeOptions: { url: '/api/orders/:id' },
  id: 'req-1',
  ...over,
});

describe('fastify adapter', () => {
  it('throws a clear error when useLogger is called outside a traced context', () => {
    expect(() => useLogger(req())).toThrow(
      '[autotel-adapters/fastify] No active trace context.',
    );
  });

  it('runs the handler with a request-scoped logger', async () => {
    const handler = withAutotel((request, reply: FastifyReplyLike) => {
      useLogger(request).set({ feature: 'checkout' });
      reply.statusCode = 201;
      return { ok: true };
    });

    await expect(handler(req(), { statusCode: 200 })).resolves.toEqual({
      ok: true,
    });
  });

  it('auto-emits one wide event with route, request id, and status', async () => {
    const onEmit = vi.fn();
    const handler = withAutotel(
      (request, reply: FastifyReplyLike) => {
        useLogger(request).set({ user: 'u1' });
        reply.statusCode = 200;
        return 'done';
      },
      { requestLoggerOptions: { onEmit } },
    );

    await handler(req({ method: 'POST' }), { statusCode: 200 });

    expect(onEmit).toHaveBeenCalledTimes(1);
    const snapshot = onEmit.mock.calls[0]?.[0] as {
      context: Record<string, unknown>;
    };
    expect(snapshot.context.user).toBe('u1');
    expect(snapshot.context['http.route']).toBe('/api/orders/:id');
    expect(snapshot.context['http.request.id']).toBe('req-1');
    expect(snapshot.context['http.response.status_code']).toBe(200);
  });

  it('does not emit when autoEmit is false', async () => {
    const onEmit = vi.fn();
    const handler = withAutotel(() => 'x', {
      autoEmit: false,
      requestLoggerOptions: { onEmit },
    });

    await handler(req(), { statusCode: 200 });
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('records the error, emits, and rethrows for fastify to handle', async () => {
    const onEmit = vi.fn();
    const boom = new Error('boom');
    const handler = withAutotel(
      () => {
        throw boom;
      },
      { requestLoggerOptions: { onEmit } },
    );

    await expect(handler(req(), { statusCode: 500 })).rejects.toThrow('boom');
    expect(onEmit).toHaveBeenCalledTimes(1);
  });
});
