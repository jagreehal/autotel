import { describe, expect, it, vi } from 'vitest';
import { defer, lastValueFrom, of, toArray } from 'rxjs';
import { AutotelInterceptor, useLogger } from './nestjs';

function mockExecutionContext(
  response: { statusCode?: number } = { statusCode: 200 },
) {
  const request = {
    method: 'GET',
    url: '/orders',
    path: '/orders',
    headers: {},
  };
  return {
    getClass: () => ({ name: 'OrdersController' }),
    getHandler: () => ({ name: 'list' }),
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
}

describe('nestjs adapter', () => {
  it('creates interceptor class', () => {
    const interceptor = new AutotelInterceptor();
    expect(interceptor.intercept).toBeTypeOf('function');
  });

  it('subscribes the handler inside request context so useLogger() resolves', async () => {
    const onEmit = vi.fn();
    const interceptor = new AutotelInterceptor({
      requestLoggerOptions: { onEmit },
    });
    let loggerResolved = false;

    // `defer` runs its factory on subscribe. If the interceptor awaited the
    // un-subscribed Observable (the old bug), the factory would never run
    // inside the ALS scope and useLogger() would throw.
    const next = {
      handle: () =>
        defer(() => {
          useLogger().set({ feature: 'checkout' });
          loggerResolved = true;
          return of('handler-result');
        }),
    };

    const result$ = await interceptor.intercept(
      mockExecutionContext() as never,
      next,
    );
    const value = await lastValueFrom(result$);

    expect(value).toBe('handler-result');
    expect(loggerResolved).toBe(true);
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it('captures a thrown handler error and still emits one wide event', async () => {
    const onEmit = vi.fn();
    const interceptor = new AutotelInterceptor({
      requestLoggerOptions: { onEmit },
    });
    const boom = new Error('handler exploded');
    const next = {
      handle: () =>
        defer(() => {
          throw boom;
        }),
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(mockExecutionContext() as never, next),
      ),
    ).rejects.toThrow('handler exploded');
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it('preserves every value emitted by the handler observable', async () => {
    const interceptor = new AutotelInterceptor();
    const next = { handle: () => of('first', 'second', 'third') };

    const result$ = await interceptor.intercept(
      mockExecutionContext() as never,
      next,
    );

    await expect(lastValueFrom(result$.pipe(toArray()))).resolves.toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});
