/**
 * Queue producer binding instrumentation
 */

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { wrap, setAttr } from './common';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import { asFunction, member, trapArgs } from '../values.js';

/**
 * Instrument Queue producer binding
 */
export function instrumentQueueProducer<T extends Queue>(
  queue: T,
  queueName?: string,
): T {
  const name = queueName || 'queue';

  const handler: ProxyHandler<T> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      if (prop === 'send' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const tracer = workerTracer('autotel-edge');

            return tracer.startActiveSpan(
              `Queue ${name}: send`,
              {
                kind: SpanKind.PRODUCER,
                attributes: {
                  'messaging.system': 'cloudflare-queues',
                  'messaging.operation.type': 'publish',
                  'messaging.operation.name': 'send',
                  'messaging.destination.name': name,
                },
              },
              async (span) => {
                try {
                  const result = await fnTarget.apply(target, args);
                  setAttr(
                    span,
                    'messaging.message.id',
                    (result as any)?.messageId,
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

      if (prop === 'sendBatch' && method) {
        return new Proxy(method, {
          apply: (fnTarget, _thisArg, args) => {
            const [messages] = trapArgs<[{ body: unknown }[]]>(args);
            const tracer = workerTracer('autotel-edge');

            return tracer.startActiveSpan(
              `Queue ${name}: sendBatch`,
              {
                kind: SpanKind.PRODUCER,
                attributes: {
                  'messaging.system': 'cloudflare-queues',
                  'messaging.operation.type': 'publish',
                  'messaging.operation.name': 'sendBatch',
                  'messaging.destination.name': name,
                  'messaging.batch.message_count': Array.isArray(messages)
                    ? messages.length
                    : 0,
                },
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

  return wrap(queue, handler);
}
