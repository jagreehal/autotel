import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { captureHttpServerRoute, createTraceCollector } from 'autotel/testing';
import { createTracedHandler } from './handlers';
import { createTracingMiddleware } from './middleware';

describe('request span name', () => {
  it('names server-function requests without the build hash', async () => {
    const collector = createTraceCollector();
    const middleware = createTracingMiddleware();

    const route = await captureHttpServerRoute(() =>
      middleware({
        next: async () => ({ status: 200 }),
        request: new Request('http://localhost/_serverFn/401dcc4eb7b', {
          method: 'POST',
        }),
        pathname: '/_serverFn/401dcc4eb7b',
        context: {},
      }),
    );

    expect(collector.expectSpan('POST /_serverFn').attributes).toMatchObject({
      'http.route': '/_serverFn',
      'tanstack.server_function.name': '401dcc4eb7b',
    });
    expect(route).toBe('/_serverFn');
  });

  it('does the same in the traced handler', async () => {
    const collector = createTraceCollector();
    const handler = createTracedHandler()(() => new Response('ok'));

    const route = await captureHttpServerRoute(() =>
      handler(new Request('http://localhost/_serverFn/ca1b26ae')),
    );

    expect(
      collector.expectSpan('GET /_serverFn').attributes[
        'tanstack.server_function.name'
      ],
    ).toBe('ca1b26ae');
    expect(route).toBe('/_serverFn');
  });

  it('names other requests after their path, with no route', async () => {
    const collector = createTraceCollector();
    const handler = createTracedHandler()(() => new Response('ok'));

    const route = await captureHttpServerRoute(() =>
      handler(new Request('http://localhost/internal/monitoring/tasks')),
    );

    expect(
      collector.expectSpan('GET /internal/monitoring/tasks').attributes[
        'http.route'
      ],
    ).toBeUndefined();
    expect(route).toBeUndefined();
  });

  describe('with a router', () => {
    const rootRoute = createRootRoute();
    const routeTree = rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/' }),
      createRoute({ getParentRoute: () => rootRoute, path: '/posts/$postId' }),
    ]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory(),
    });

    it('names a request after the route it matches', async () => {
      const collector = createTraceCollector();
      const middleware = createTracingMiddleware({ router });

      const route = await captureHttpServerRoute(() =>
        middleware({
          next: async () => ({ status: 200 }),
          request: new Request('http://localhost/posts/123'),
          pathname: '/posts/123',
          context: {},
        }),
      );

      expect(
        collector.expectSpan('GET /posts/$postId').attributes['http.route'],
      ).toBe('/posts/$postId');
      expect(route).toBe('/posts/$postId');
    });

    it('does the same in the traced handler', async () => {
      const collector = createTraceCollector();
      const handler = createTracedHandler({ router })(() => new Response('ok'));

      const route = await captureHttpServerRoute(() =>
        handler(new Request('http://localhost/posts/7')),
      );

      expect(collector.expectSpan('GET /posts/$postId')).toBeDefined();
      expect(route).toBe('/posts/$postId');
    });

    it('matches under the router basepath', async () => {
      const collector = createTraceCollector();
      const mounted = createRouter({
        routeTree,
        basepath: '/app',
        history: createMemoryHistory(),
      });
      const handler = createTracedHandler({ router: mounted })(
        () => new Response('ok'),
      );

      const route = await captureHttpServerRoute(() =>
        handler(new Request('http://localhost/app/posts/123')),
      );

      expect(collector.expectSpan('GET /app/posts/$postId')).toBeDefined();
      expect(route).toBe('/app/posts/$postId');
    });

    it('hands a custom rewrite the request host and query', async () => {
      const collector = createTraceCollector();
      const seen: string[] = [];
      const rewritten = createRouter({
        routeTree,
        history: createMemoryHistory(),
        rewrite: {
          input: ({ url }) => {
            seen.push(url.href);
            // Tenants on their own host share one set of routes.
            if (url.hostname === 'acme.example.com') {
              url.pathname = url.pathname.replace(/^\/acme/, '');
            }
            return url;
          },
        },
      });
      const handler = createTracedHandler({ router: rewritten })(
        () => new Response('ok'),
      );

      await captureHttpServerRoute(() =>
        handler(new Request('https://acme.example.com/acme/posts/9?tab=1')),
      );

      expect(seen).toContain('https://acme.example.com/acme/posts/9?tab=1');
      expect(collector.expectSpan('GET /posts/$postId')).toBeDefined();
    });

    it('names a server function under a basepath without its hash', async () => {
      const collector = createTraceCollector();
      const handler = createTracedHandler()(() => new Response('ok'));

      const route = await captureHttpServerRoute(() =>
        handler(new Request('http://localhost/app/_serverFn/401dcc4e')),
      );

      expect(collector.expectSpan('GET /app/_serverFn')).toBeDefined();
      expect(route).toBe('/app/_serverFn');
    });

    it('gives a request that only partly matches no route', async () => {
      const collector = createTraceCollector();
      const handler = createTracedHandler({ router })(
        () => new Response('missing', { status: 404 }),
      );

      const route = await captureHttpServerRoute(() =>
        handler(new Request('http://localhost/posts/1/comments/xyz')),
      );

      expect(collector.expectSpan('GET /posts/1/comments/xyz')).toBeDefined();
      expect(route).toBeUndefined();
    });

    it('keeps the path for a request no route matches', async () => {
      const collector = createTraceCollector();
      const handler = createTracedHandler({ router })(
        () => new Response('missing', { status: 404 }),
      );

      const route = await captureHttpServerRoute(() =>
        handler(new Request('http://localhost/nowhere/here')),
      );

      expect(
        collector.expectSpan('GET /nowhere/here').attributes['http.route'],
      ).toBeUndefined();
      expect(route).toBeUndefined();
    });
  });
});
