/**
 * Analytics Engine binding instrumentation
 */

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { wrap } from './common';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import { asFunction, member, trapArgs } from '../values.js';

/**
 * Instrument Analytics Engine binding
 */
export function instrumentAnalyticsEngine<T extends AnalyticsEngineDataset>(
  ae: T,
  datasetName?: string,
): T {
  const name = datasetName || 'analytics-engine';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'writeDataPoint' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [dataPoint] =
              trapArgs<[AnalyticsEngineDataPoint | undefined]>(args);
            const tracer = workerTracer('autotel-edge');

            const attributes: Record<string, string | number> = {
              'analytics.system': 'cloudflare-analytics-engine',
              'analytics.operation': 'writeDataPoint',
            };

            if (dataPoint) {
              if (dataPoint.indexes) {
                attributes['analytics.indexes_count'] = Array.isArray(
                  dataPoint.indexes,
                )
                  ? dataPoint.indexes.length
                  : 1;
              }
              if (dataPoint.doubles) {
                attributes['analytics.doubles_count'] =
                  dataPoint.doubles.length;
              }
              if (dataPoint.blobs) {
                attributes['analytics.blobs_count'] = dataPoint.blobs.length;
              }
            }

            return tracer.startActiveSpan(
              `AnalyticsEngine ${name}: writeDataPoint`,
              {
                kind: SpanKind.CLIENT,
                attributes,
              },
              (span) => {
                try {
                  // writeDataPoint is synchronous/void
                  fnTarget.apply(target, args);
                  span.setStatus({ code: SpanStatusCode.OK });
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

  return wrap(ae, handler);
}
