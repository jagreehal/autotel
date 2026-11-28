import { init } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { debugHeadersMiddleware } from './debug-headers';
import { metricsCollector } from './metrics';
import { createTracingMiddleware } from './middleware';

/**
 * The shapes TanStack Start (1.169) resolves next() to. Request middleware
 * gets { request, pathname, context, response }; function middleware gets the
 * middleware context with the handler's return value under `result`.
 */
const requestResult = (request: Request, status: number) => ({
  request,
  pathname: new URL(request.url).pathname,
  context: {},
  response: new Response('body', { status }),
});

describe('against TanStack Start result shapes', () => {
  beforeAll(() => {
    init({ service: 'tanstack-result-shapes-test' });
  });

  const requestMiddleware = createTracingMiddleware();

  async function requestSpanFor(path: string, status: number) {
    const collector = createTraceCollector();
    const request = new Request(`http://localhost${path}`);
    await requestMiddleware({
      request,
      pathname: new URL(request.url).pathname,
      context: {},
      next: () => Promise.resolve(requestResult(request, status)),
    });
    const [span] = collector.getSpans();
    return span!;
  }

  it('records the response status code', async () => {
    const span = await requestSpanFor('/users', 200);
    expect(span.attributes['http.response.status_code']).toBe(200);
  });

  it('marks a 5xx as an error and leaves a 4xx unflagged', async () => {
    const failed = await requestSpanFor('/boom', 503);
    expect(failed.status.code).toBe(2);
    const notFound = await requestSpanFor('/missing', 404);
    expect(notFound.attributes['http.response.status_code']).toBe(404);
    expect(notFound.status.code).toBe(0); // unset: the client's error
  });

  it('records url.query without its leading ?', async () => {
    const span = await requestSpanFor('/search?q=shoes', 200);
    expect(span.attributes['url.query']).toBe('q=shoes');
  });

  it('captures only the function result, not the middleware context', async () => {
    const collector = createTraceCollector();
    const fnMiddleware = createTracingMiddleware({
      type: 'function',
      captureResults: true,
    });
    await fnMiddleware({
      context: {},
      serverFnMeta: { name: 'getUser' },
      next: () =>
        Promise.resolve({
          result: { id: 1 },
          context: { session: { token: 'secret' } },
          sendContext: {},
        }),
    });
    const [span] = collector.getSpansByName('tanstack.serverFn.getUser');
    expect(span!.attributes['tanstack.server_function.result']).toBe(
      '{"id":1}',
    );
  });

  it('does not record server function input unless asked', async () => {
    const collector = createTraceCollector();
    await createTracingMiddleware({ type: 'function' })({
      context: {},
      data: { email: 'a@b.c', password: 'hunter2' },
      serverFnMeta: { name: 'login' },
      next: () => Promise.resolve({ result: undefined }),
    });
    const [span] = collector.getSpansByName('tanstack.serverFn.login');
    expect(span!.attributes['tanstack.server_function.args']).toBeUndefined();
  });

  it('adds debug headers to the response inside the result', async () => {
    const request = new Request('http://localhost/');
    const result = await debugHeadersMiddleware({ enabled: true })({
      request,
      context: {},
      next: () => Promise.resolve(requestResult(request, 200)),
    });
    // The middleware hands back the shape next() resolved to.
    const response: Response = result.response;
    expect(response.headers.get('X-Debug-Timestamp')).toBeTruthy();
    expect(response.status).toBe(200);
  });

  it('stops adding timing names past its cap', () => {
    metricsCollector.reset();
    for (let i = 0; i < 600; i++)
      metricsCollector.recordTiming(`GET /u/${i}`, 1);
    expect(Object.keys(metricsCollector.getAllStats())).toHaveLength(500);
    metricsCollector.reset();
  });
});
