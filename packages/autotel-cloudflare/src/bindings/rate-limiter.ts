/**
 * Rate Limiter binding instrumentation
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap, setAttr } from './common';

interface RateLimiterLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Instrument Rate Limiter binding (manual only — not auto-detected)
 */
export function instrumentRateLimiter<T extends RateLimiterLike>(limiter: T, bindingName?: string): T {
  const name = bindingName || 'rate-limiter';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'limit' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [options] = args as [{ key: string }];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `RateLimiter ${name}: limit`,
              {
                kind: SpanKind.CLIENT,
                attributes: {
                  'rate_limiter.system': 'cloudflare-rate-limiter',
                  'rate_limiter.key': options?.key,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);
                  setAttr(span, 'rate_limiter.success', result?.success);
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
        });
      }

      return value;
    },
  };

  return wrap(limiter, handler);
}
