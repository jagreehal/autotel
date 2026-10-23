import { describe, expect, it, vi } from 'vitest';
import { createTraceCollector } from 'autotel/testing';
import { useLogger, withAutotel } from './express';
import type { ExpressRequestLike, ExpressResponseLike } from './express';

const req = (over: Partial<ExpressRequestLike> = {}): ExpressRequestLike => ({
  method: 'GET',
  originalUrl: '/api/orders',
  ...over,
});

describe('express adapter', () => {
  it('throws a clear error when useLogger is called outside a traced context', () => {
    expect(() => useLogger(req())).toThrow(
      '[autotel-adapters/express] No active trace context.',
    );
  });

  it('runs the handler with a request-scoped logger', async () => {
    const handler = withAutotel((request, res: ExpressResponseLike) => {
      useLogger(request).set({ feature: 'checkout' });
      res.statusCode = 201;
      return 'ok';
    });

    await expect(handler(req(), { statusCode: 200 })).resolves.toBe('ok');
  });

  it('auto-emits one wide event with accumulated context and status', async () => {
    const onEmit = vi.fn();
    const handler = withAutotel(
      (request, res: ExpressResponseLike) => {
        useLogger(request).set({ user: 'u1' });
        res.statusCode = 200;
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
    expect(snapshot.context['http.request.method']).toBe('POST');
    expect(snapshot.context['http.response.status_code']).toBe(200);
  });

  it('sets http.route from the matched template, never the raw path', async () => {
    const onEmit = vi.fn();
    const handler = withAutotel(() => 'ok', {
      requestLoggerOptions: { onEmit },
    });

    await handler(
      req({
        originalUrl: '/api/orders/42',
        path: '/orders/42',
        route: { path: '/orders/:id' },
      }),
      {},
    );
    await handler(req({ path: '/api/orders' }), {});

    expect(onEmit.mock.calls[0]?.[0].context).toMatchObject({
      'http.route': '/orders/:id',
      'url.path': '/api/orders/42',
    });
    expect(onEmit.mock.calls[1]?.[0].context['http.route']).toBeUndefined();
  });

  it('keeps a parameterised mount path out of http.route and the span name', async () => {
    const collector = createTraceCollector();
    const onEmit = vi.fn();
    const handler = withAutotel(() => 'ok', {
      requestLoggerOptions: { onEmit },
    });

    await handler(
      req({
        originalUrl: '/orgs/secret-tenant/users/7',
        baseUrl: '/orgs/secret-tenant',
        route: { path: '/users/:id' },
      } as ExpressRequestLike),
      {},
    );

    expect(onEmit.mock.calls[0]?.[0].context['http.route']).toBe('/users/:id');
    expect(collector.expectSpan('GET /users/:id')).toBeDefined();
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

  it('records the error, emits, and forwards to next', async () => {
    const onEmit = vi.fn();
    const next = vi.fn();
    const boom = new Error('boom');
    const handler = withAutotel(
      () => {
        throw boom;
      },
      { requestLoggerOptions: { onEmit } },
    );

    await expect(
      handler(req(), { statusCode: 500 }, next),
    ).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledWith(boom);
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it('rethrows when no next is provided', async () => {
    const handler = withAutotel(() => {
      throw new Error('no-next');
    });
    await expect(handler(req(), { statusCode: 500 })).rejects.toThrow(
      'no-next',
    );
  });
});
