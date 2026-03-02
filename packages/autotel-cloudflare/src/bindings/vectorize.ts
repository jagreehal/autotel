/**
 * Vectorize binding instrumentation
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap, setAttr } from './common';

const TRACED_METHODS = ['query', 'insert', 'upsert', 'deleteByIds', 'getByIds', 'describe'] as const;

/**
 * Instrument Vectorize index binding
 */
export function instrumentVectorize<T extends VectorizeIndex>(vectorize: T, indexName?: string): T {
  const name = indexName || 'vectorize';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (typeof prop === 'string' && TRACED_METHODS.includes(prop as any) && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const operation = prop as string;
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            const attributes: Record<string, string | number> = {
              'db.system': 'cloudflare-vectorize',
              'db.operation': operation,
              'db.collection.name': name,
            };

            // Per-operation attributes
            if (operation === 'query') {
              const queryInput = args[0] as { topK?: number } | undefined;
              if (queryInput?.topK !== undefined) {
                attributes['db.vectorize.top_k'] = queryInput.topK;
              }
            }

            if ((operation === 'insert' || operation === 'upsert') && Array.isArray(args[0])) {
              attributes['db.vectorize.vectors_count'] = args[0].length;
            }

            return tracer.startActiveSpan(
              `Vectorize ${name}: ${operation}`,
              {
                kind: SpanKind.CLIENT,
                attributes,
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, target, args);

                  if (operation === 'query' && result?.matches) {
                    setAttr(span, 'db.vectorize.matches_count', result.matches.length);
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
        });
      }

      return value;
    },
  };

  return wrap(vectorize, handler);
}
