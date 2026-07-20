import { describe, expect, it, vi } from 'vitest';
import { extendDeferredDrain } from './deferred-drain';
import {
  getServiceForPath,
  matchesRoutePattern,
  mergeRequestLoggerOptions,
  shouldInstrumentPath,
} from './middleware';

describe('route matching', () => {
  it('matches glob patterns', () => {
    expect(matchesRoutePattern('/api/users', '/api/*')).toBe(true);
    expect(matchesRoutePattern('/health', '/api/*')).toBe(false);
  });

  it('filters include/exclude paths', () => {
    expect(
      shouldInstrumentPath('/api/orders', {
        include: ['/api/*'],
        exclude: ['/api/internal/*'],
      }),
    ).toBe(true);
    expect(
      shouldInstrumentPath('/api/internal/sync', {
        include: ['/api/*'],
        exclude: ['/api/internal/*'],
      }),
    ).toBe(false);
  });

  it('resolves route service overrides', () => {
    expect(
      getServiceForPath('/checkout', {
        '/checkout': { service: 'checkout-api' },
      }),
    ).toBe('checkout-api');
  });
});

describe('extendDeferredDrain', () => {
  it('registers drain with waitUntil without awaiting', async () => {
    const waitUntil = vi.fn();
    let resolved = false;
    const drain = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolved = true;
        resolve();
      }, 10);
    });

    extendDeferredDrain(drain, waitUntil);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    await drain;
    expect(resolved).toBe(true);
  });
});

describe('mergeRequestLoggerOptions', () => {
  it('wraps onEmit with waitUntil', async () => {
    const waitUntil = vi.fn();
    const userOnEmit = vi.fn(async () => {});
    const merged = mergeRequestLoggerOptions({ onEmit: userOnEmit }, waitUntil);
    expect(merged?.onEmit).toBeTypeOf('function');
    await merged?.onEmit?.({
      timestamp: new Date().toISOString(),
      traceId: 't',
      spanId: 's',
      correlationId: 'c',
      context: {},
    });
    expect(userOnEmit).toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalled();
  });
});
