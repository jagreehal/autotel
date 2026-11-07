import { beforeEach, describe, expect, it, vi } from 'vitest';

const { routeSpy } = vi.hoisted(() => ({ routeSpy: vi.fn(() => true) }));

vi.mock('autotel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('autotel')>()),
  setHttpServerRoute: routeSpy,
}));

import { withAutotel as withExpress } from './express';
import { withAutotel as withFastify } from './fastify';

describe('request runner route', () => {
  beforeEach(() => routeSpy.mockClear());

  it('hands the Express route template to the HTTP server span', async () => {
    const handler = withExpress(() => 'ok');

    await handler(
      {
        method: 'GET',
        originalUrl: '/users/42',
        route: { path: '/users/:id' },
      },
      { statusCode: 200 },
    );

    expect(routeSpy.mock.calls).toEqual([['/users/:id']]);
  });

  it('hands the Fastify route template to the HTTP server span', async () => {
    const handler = withFastify(() => 'ok');

    await handler(
      { method: 'GET', url: '/users/42', routeOptions: { url: '/users/:id' } },
      { statusCode: 200 },
    );

    expect(routeSpy.mock.calls).toEqual([['/users/:id']]);
  });

  it('leaves the server span alone when no route matched', async () => {
    await withExpress(() => 'ok')({ method: 'GET', originalUrl: '/x' }, {});
    await withFastify(() => 'ok')({ method: 'GET', url: '/x' }, {});

    expect(routeSpy).not.toHaveBeenCalled();
  });
});
