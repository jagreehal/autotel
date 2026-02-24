/**
 * Hyperdrive binding instrumentation
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap, setAttr } from './common';

/**
 * Instrument Hyperdrive binding
 */
export function instrumentHyperdrive<T extends Hyperdrive>(hyperdrive: T, bindingName?: string): T {
  const name = bindingName || 'hyperdrive';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'connect' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, thisArg, args) => {
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            const attributes: Record<string, string | number> = {
              'db.system': 'cloudflare-hyperdrive',
              'db.operation': 'connect',
            };

            // Extract connection info safely (never record password)
            try {
              setAttr({ setAttribute: (k: string, v: any) => { if (v !== undefined && v !== null) attributes[k] = v; } }, 'server.address', target.host);
              setAttr({ setAttribute: (k: string, v: any) => { if (v !== undefined && v !== null) attributes[k] = v; } }, 'server.port', target.port);
              setAttr({ setAttribute: (k: string, v: any) => { if (v !== undefined && v !== null) attributes[k] = v; } }, 'db.user', target.user);
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
                  const result = await Reflect.apply(fnTarget, thisArg, args);
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

  return wrap(hyperdrive, handler);
}
