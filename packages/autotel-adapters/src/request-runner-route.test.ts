import { setHttpServerRoute } from 'autotel';
import { describe, expect, it } from 'vitest';
import { captureHttpServerRoute } from 'autotel/testing';
import { withAutotel as withExpress } from './express';
import { withAutotel as withFastify } from './fastify';

describe('request runner route', () => {
  it('hands the Express route template to the HTTP server span', async () => {
    const handler = withExpress(() => 'ok');

    const route = await captureHttpServerRoute(() =>
      handler(
        {
          method: 'GET',
          originalUrl: '/users/42',
          route: { path: '/users/:id' },
        },
        { statusCode: 200 },
      ),
    );

    expect(route).toBe('/users/:id');
  });

  it('hands the Fastify route template to the HTTP server span', async () => {
    const handler = withFastify(() => 'ok');

    const route = await captureHttpServerRoute(() =>
      handler(
        {
          method: 'GET',
          url: '/users/42',
          routeOptions: { url: '/users/:id' },
        },
        { statusCode: 200 },
      ),
    );

    expect(route).toBe('/users/:id');
  });

  it('keeps the full template Express instrumentation already recorded', async () => {
    const handler = withExpress(() => 'ok');

    const route = await captureHttpServerRoute(() => {
      // What instrumentation-express records once nested routers match.
      setHttpServerRoute('/orgs/:orgId/users/:id');
      return handler(
        {
          method: 'GET',
          originalUrl: '/orgs/7/users/42',
          route: { path: '/users/:id' },
        },
        { statusCode: 200 },
      );
    });

    expect(route).toBe('/orgs/:orgId/users/:id');
  });

  it('hands no relative route from under a mounted Express router', async () => {
    const handler = withExpress(() => 'ok');

    const route = await captureHttpServerRoute(() =>
      handler(
        {
          method: 'GET',
          baseUrl: '/orgs/7',
          originalUrl: '/orgs/7/users/42',
          route: { path: '/users/:id' },
        },
        { statusCode: 200 },
      ),
    );

    expect(route).toBeUndefined();
  });

  it('leaves the server span alone when no route matched', async () => {
    const express = await captureHttpServerRoute(() =>
      withExpress(() => 'ok')({ method: 'GET', originalUrl: '/x' }, {}),
    );
    const fastify = await captureHttpServerRoute(() =>
      withFastify(() => 'ok')({ method: 'GET', url: '/x' }, {}),
    );

    expect(express).toBeUndefined();
    expect(fastify).toBeUndefined();
  });
});
