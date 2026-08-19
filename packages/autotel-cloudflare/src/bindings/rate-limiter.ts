/**
 * Rate Limiter binding instrumentation
 */

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { wrap, setAttr } from './common';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import {
  asBoolean,
  asFunction,
  member,
  readProperty,
  trapArgs,
} from '../values.js';

interface RateLimiterLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Instrument Rate Limiter binding (manual only — not auto-detected)
 */
export function instrumentRateLimiter<T extends RateLimiterLike>(
  limiter: T,
  bindingName?: string,
): T {
  const name = bindingName || 'rate-limiter';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'limit' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [options] = trapArgs<[{ key: string }]>(args);
            const tracer = workerTracer('autotel-edge');

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
                  const result = await fnTarget.apply(target, args);
                  setAttr(
                    span,
                    'rate_limiter.success',
                    asBoolean(readProperty(result, 'success')),
                  );
                  span.setStatus({ code: SpanStatusCode.OK });
                  return result;
                } catch (error) {
                  span.recordException(toException(error));
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message:
                      error instanceof Error ? error.message : String(error),
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
