/**
 * Vectorize binding instrumentation
 */

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { wrap, setAttr } from './common';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import { asFunction, member, readProperty } from '../values.js';

const TRACED_METHODS = [
  'query',
  'insert',
  'upsert',
  'deleteByIds',
  'getByIds',
  'describe',
] as const;

/**
 * Instrument Vectorize index binding
 */
export function instrumentVectorize<T extends VectorizeIndex>(
  vectorize: T,
  indexName?: string,
): T {
  const name = indexName || 'vectorize';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (
        typeof prop === 'string' &&
        TRACED_METHODS.includes(prop as any) &&
        method !== undefined
      ) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const operation = prop as string;
            const tracer = workerTracer('autotel-edge');

            const attributes: Record<string, string | number> = {
              'db.system.name': 'cloudflare-vectorize',
              'db.operation.name': operation,
              'db.collection.name': name,
            };

            // Per-operation attributes
            if (operation === 'query') {
              const queryInput = args[0] as { topK?: number } | undefined;
              if (queryInput?.topK !== undefined) {
                attributes['db.vectorize.top_k'] = queryInput.topK;
              }
            }

            if (
              (operation === 'insert' || operation === 'upsert') &&
              Array.isArray(args[0])
            ) {
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
                  const result = await fnTarget.apply(target, args);

                  const matches = readProperty(result, 'matches');
                  if (operation === 'query' && Array.isArray(matches)) {
                    setAttr(span, 'db.vectorize.matches_count', matches.length);
                  }

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

  return wrap(vectorize, handler);
}
