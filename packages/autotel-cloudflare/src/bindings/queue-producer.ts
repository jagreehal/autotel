/**
 * Queue producer binding instrumentation
 */

import {
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap, setAttr } from './common';

/**
 * Instrument Queue producer binding
 */
export function instrumentQueueProducer<T extends Queue>(queue: T, queueName?: string): T {
  const name = queueName || 'queue';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      if (prop === 'send' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, thisArg, args) => {
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `Queue ${name}: send`,
              {
                kind: SpanKind.PRODUCER,
                attributes: {
                  'messaging.system': 'cloudflare-queues',
                  'messaging.operation.type': 'publish',
                  'messaging.operation': 'send',
                  'messaging.destination.name': name,
                },
              },
              async (span) => {
                try {
                  const result = await Reflect.apply(fnTarget, thisArg, args);
                  setAttr(span, 'messaging.message.id', (result as any)?.messageId);
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

      if (prop === 'sendBatch' && typeof value === 'function') {
        return new Proxy(value, {
          apply: (fnTarget, thisArg, args) => {
            const [messages] = args as [{ body: unknown }[]];
            const tracer = trace.getTracer('autotel-edge') as WorkerTracer;

            return tracer.startActiveSpan(
              `Queue ${name}: sendBatch`,
              {
                kind: SpanKind.PRODUCER,
                attributes: {
                  'messaging.system': 'cloudflare-queues',
                  'messaging.operation.type': 'publish',
                  'messaging.operation': 'sendBatch',
                  'messaging.destination.name': name,
                  'messaging.batch.message_count': Array.isArray(messages) ? messages.length : 0,
                },
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

  return wrap(queue, handler);
}
