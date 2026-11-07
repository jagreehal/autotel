import { describe, expect, it, vi } from 'vitest';

const { routeSpy } = vi.hoisted(() => ({ routeSpy: vi.fn(() => true) }));

vi.mock('autotel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('autotel')>()),
  setHttpServerRoute: routeSpy,
}));

import { defineFrameworkIntegration } from './integration';

describe('framework integration route', () => {
  it('hands the matched route to the HTTP server span, and a later one too', async () => {
    const integration = defineFrameworkIntegration<{ path: string }>({
      name: 'test',
      extractRequest: (ctx) => ({
        method: 'GET',
        path: ctx.path,
        route: '/users/:id',
      }),
      attachLogger: vi.fn(),
    });

    await integration.runTraced({ path: '/users/42' }, {}, async (handle) => {
      handle.setRoute('/v2/users/:id');

      return 'ok';
    });

    expect(routeSpy.mock.calls).toEqual([['/users/:id'], ['/v2/users/:id']]);
  });
});
