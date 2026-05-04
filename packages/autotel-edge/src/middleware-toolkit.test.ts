import { describe, expect, it, vi } from 'vitest';
import {
  getServiceForPath,
  matchesRoutePattern,
  runMiddlewareFinishPipeline,
  shouldInstrumentPath,
} from './middleware-toolkit';

describe('middleware-toolkit', () => {
  it('matches glob route patterns', () => {
    expect(matchesRoutePattern('/api/users/123', '/api/**')).toBe(true);
    expect(matchesRoutePattern('/api/users/123', '/admin/**')).toBe(false);
    expect(matchesRoutePattern('/a/b', '/a/?')).toBe(true);
  });

  it('applies exclude before include', () => {
    expect(
      shouldInstrumentPath('/health', {
        include: ['/health'],
        exclude: ['/health'],
      }),
    ).toBe(false);
  });

  it('defaults to true when include is empty', () => {
    expect(shouldInstrumentPath('/anything')).toBe(true);
  });

  it('resolves service from first matching route', () => {
    const service = getServiceForPath('/api/admin/users', {
      '/api/admin/**': { service: 'admin' },
      '/api/**': { service: 'api' },
    });
    expect(service).toBe('admin');
  });

  it('runs enrichers and drains with isolation', async () => {
    const logger = { error: vi.fn() };
    const seen: string[] = [];

    await runMiddlewareFinishPipeline(
      {
        event: { id: '1' },
        request: { path: '/api' },
      },
      {
        logger,
        enrichers: [
          async () => {
            seen.push('enrich-ok');
          },
          async () => {
            throw new Error('enrich-fail');
          },
        ],
        drains: [
          async () => {
            seen.push('drain-ok');
          },
          async () => {
            throw new Error('drain-fail');
          },
        ],
      },
    );

    expect(seen).toContain('enrich-ok');
    expect(seen).toContain('drain-ok');
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
