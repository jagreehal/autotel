import { describe, expect, it } from 'vitest';
import { setHttpServerRoute } from './server-route';
import { captureHttpServerRoute } from './testing';

describe('setHttpServerRoute', () => {
  it('hands the route to the HTTP server span of the request', async () => {
    let handed = false;

    const route = await captureHttpServerRoute(() => {
      handed = setHttpServerRoute('/users/:id');
    });

    expect(handed).toBe(true);
    expect(route).toBe('/users/:id');
  });

  it('keeps the last route handed, through an await', async () => {
    const route = await captureHttpServerRoute(async () => {
      setHttpServerRoute('/users/:id');
      await Promise.resolve();
      setHttpServerRoute('/v2/users/:id');
    });

    expect(route).toBe('/v2/users/:id');
  });

  it('keeps a route already recorded when asked to', async () => {
    let results: boolean[] = [];

    const route = await captureHttpServerRoute(() => {
      results = [
        setHttpServerRoute('/orgs/:orgId/users/:id'),
        setHttpServerRoute('/users/:id', { keepExisting: true }),
      ];
    });

    expect(results).toEqual([true, false]);
    expect(route).toBe('/orgs/:orgId/users/:id');
  });

  it('says so when no HTTP server span is listening', () => {
    expect(setHttpServerRoute('/users/:id')).toBe(false);
  });
});
