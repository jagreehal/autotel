/**
 * Global Cache API instrumentation for Cloudflare Workers
 *
 * Automatically traces cache operations:
 * - cache.match() - Read from cache
 * - cache.put() - Write to cache
 * - cache.delete() - Delete from cache
 */

import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { wrap } from '../bindings/common';
import { WorkerTracer } from 'autotel-edge';

type CacheOperation = 'match' | 'put' | 'delete';

/**
 * Sanitize URL for span attributes (remove query params that might contain sensitive data)
 */
function sanitizeURL(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}${u.pathname}`;
}

/**
 * Instrument a cache method (match, put, delete)
 */
function instrumentCacheMethod<T extends Function>(
  fn: T,
  cacheName: string,
  operation: CacheOperation,
): T {
  const handler: ProxyHandler<T> = {
    async apply(target, thisArg, argArray) {
      const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

      // Extract URL from first argument (Request or string)
      const firstArg = argArray[0];
      const url =
        firstArg instanceof Request
          ? firstArg.url
          : typeof firstArg === 'string'
            ? firstArg
            : undefined;

      const spanName = `Cache ${cacheName}.${operation}`;

      return tracer.startActiveSpan(
        spanName,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            'cache.name': cacheName,
            'cache.operation': operation,
            'cache.key': url ? sanitizeURL(url) : undefined,
          },
        },
        async (span) => {
          try {
            const result = await Reflect.apply(target, thisArg, argArray);

            // For match operations, record whether it was a hit or miss
            if (operation === 'match') {
              span.setAttribute('cache.hit', !!result);
            }

            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  };

  return wrap(fn, handler);
}

/**
 * Instrument a Cache instance
 */
function instrumentCache(cache: Cache, cacheName: string): Cache {
  const handler: ProxyHandler<Cache> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      // Instrument the cache operation methods
      if (
        (prop === 'match' || prop === 'put' || prop === 'delete') &&
        typeof value === 'function'
      ) {
        return instrumentCacheMethod(
          value.bind(target),
          cacheName,
          prop as CacheOperation,
        );
      }

      // Bind other methods to preserve `this` context
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  };

  return wrap(cache, handler);
}

/**
 * Instrument caches.open()
 */
function instrumentCachesOpen(
  openFn: CacheStorage['open'],
): CacheStorage['open'] {
  const handler: ProxyHandler<CacheStorage['open']> = {
    async apply(target, thisArg, argArray) {
      const cacheName = argArray[0];
      const cache = await Reflect.apply(target, thisArg, argArray);
      return instrumentCache(cache, cacheName);
    },
  };

  return wrap(openFn, handler);
}

/**
 * Instrument the global caches API
 *
 * This wraps globalThis.caches to automatically create spans for all cache operations.
 *
 * **Note:** This is called automatically when the library is initialized with
 * `instrumentation.instrumentGlobalCache: true` (default).
 */
export function instrumentGlobalCache(): void {
  const handler: ProxyHandler<typeof caches> = {
    get(target, prop) {
      if (prop === 'default') {
        // Wrap the default cache
        return instrumentCache(target.default, 'default');
      } else if (prop === 'open') {
        // Wrap the open method
        const openFn = Reflect.get(target, prop);
        if (typeof openFn === 'function') {
          return instrumentCachesOpen(openFn.bind(target));
        }
      }

      return Reflect.get(target, prop);
    },
  };

  // Replace global caches
  // @ts-ignore - TypeScript doesn't like reassigning globalThis.caches
  globalThis.caches = wrap(caches, handler);
}
