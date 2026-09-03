/**
 * Hyperdrive binding instrumentation
 */

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { wrap, setAttr } from './common';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import { asFunction, member } from '../values.js';

/**
 * Instrument Hyperdrive binding
 */
export function instrumentHyperdrive<T extends Hyperdrive>(
  hyperdrive: T,
  bindingName?: string,
): T {
  const name = bindingName || 'hyperdrive';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'connect' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const tracer = workerTracer('autotel-edge');

            const attributes: Record<string, string | number> = {
              'db.system.name': 'cloudflare-hyperdrive',
              'db.operation.name': 'connect',
            };

            // Extract connection info safely (never record password)
            try {
              setAttr(
                {
                  setAttribute: (k: string, v: any) => {
                    if (v !== undefined && v !== null) attributes[k] = v;
                  },
                },
                'server.address',
                target.host,
              );
              setAttr(
                {
                  setAttribute: (k: string, v: any) => {
                    if (v !== undefined && v !== null) attributes[k] = v;
                  },
                },
                'server.port',
                target.port,
              );
              setAttr(
                {
                  setAttribute: (k: string, v: any) => {
                    if (v !== undefined && v !== null) attributes[k] = v;
                  },
                },
                'db.user',
                target.user,
              );
            } catch {
              // Properties may not be accessible in all environments
            }

            return tracer.startActiveSpan(
              `Hyperdrive ${name}: connect`,
              {
                kind: SpanKind.CLIENT,
                attributes,
              },
              async (span) => {
                try {
                  const result = await fnTarget.apply(target, args);
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

  return wrap(hyperdrive, handler);
}
