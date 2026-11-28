import { init } from 'autotel';
import { createTraceCollector } from 'autotel/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTracingMiddleware } from './middleware';

/**
 * TanStack Start (>= 1.169) hands function middleware `serverFnMeta`
 * ({ id, name, filename }); older versions send `functionId`. The span name
 * comes from `serverFnMeta.name`, then `functionId`.
 */
describe('server function span names', () => {
  beforeAll(() => {
    init({ service: 'tanstack-server-fn-name-test' });
  });

  const middleware = createTracingMiddleware({ type: 'function' });
  const next = () => Promise.resolve({});

  it('names the span after serverFnMeta.name, as TanStack Start sends it', async () => {
    const collector = createTraceCollector();

    await middleware({
      next,
      context: {},
      method: 'POST',
      serverFnMeta: {
        id: 'eyJmaWxlIjoiL3NyYy9zZXJ2ZXIvdHJhY2tzLnRzIn0',
        name: 'updateTrack',
        filename: 'src/server/tracks.ts',
      },
    });

    const [span] = collector.getSpansByName('tanstack.serverFn.updateTrack');
    expect(span).toBeDefined();
    expect(span?.attributes['tanstack.server_function.name']).toBe(
      'updateTrack',
    );
    expect(collector.getSpansByName('tanstack.serverFn.unknown')).toHaveLength(
      0,
    );
  });

  it('still reads functionId from older TanStack Start versions', async () => {
    const collector = createTraceCollector();

    await middleware({ next, context: {}, functionId: 'getUser' });

    expect(collector.getSpansByName('tanstack.serverFn.getUser')).toHaveLength(
      1,
    );
  });
});
