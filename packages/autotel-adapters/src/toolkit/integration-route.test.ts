import { describe, expect, it, vi } from 'vitest';
import { captureHttpServerRoute } from 'autotel/testing';
import { defineFrameworkIntegration } from './integration';

const integration = defineFrameworkIntegration<{ path: string }>({
  name: 'test',
  extractRequest: (ctx) => ({
    method: 'GET',
    path: ctx.path,
    route: '/users/:id',
  }),
  attachLogger: vi.fn(),
});

describe('framework integration route', () => {
  it('hands the matched route to the HTTP server span', async () => {
    const route = await captureHttpServerRoute(() =>
      integration.runTraced({ path: '/users/42' }, {}, async () => 'ok'),
    );

    expect(route).toBe('/users/:id');
  });

  it('hands a route set later in the request too', async () => {
    const route = await captureHttpServerRoute(() =>
      integration.runTraced({ path: '/users/42' }, {}, async (handle) => {
        handle.setRoute('/v2/users/:id');
        return 'ok';
      }),
    );

    expect(route).toBe('/v2/users/:id');
  });
});
