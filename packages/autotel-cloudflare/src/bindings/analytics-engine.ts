/**
 * Analytics Engine binding instrumentation
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap } from './common';

/**
 * Instrument Analytics Engine binding
 */
export function instrumentAnalyticsEngine<T extends AnalyticsEngineDataset>(ae: T, datasetName?: string): T {
  const name = datasetName || 'analytics-engine';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'writeDataPoint' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, _thisArg, args) => {
            const [dataPoint] = args as [AnalyticsEngineDataPoint | undefined];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            const attributes: Record<string, string | number> = {
              'analytics.system': 'cloudflare-analytics-engine',
              'analytics.operation': 'writeDataPoint',
            };

            if (dataPoint) {
              if (dataPoint.indexes) {
                attributes['analytics.indexes_count'] = Array.isArray(dataPoint.indexes) ? dataPoint.indexes.length : 1;
              }
              if (dataPoint.doubles) {
                attributes['analytics.doubles_count'] = dataPoint.doubles.length;
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
                  Reflect.apply(fnTarget, target, args);
                  span.setStatus({ code: SpanStatusCode.OK });
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

  return wrap(ae, handler);
}
