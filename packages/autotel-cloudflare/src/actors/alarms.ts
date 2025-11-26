/**
 * Actor alarms instrumentation
 *
 * Traces operations on actor.alarms
 */

import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap } from '../bindings/common';
import type { ActorLike } from './types';

/**
 * Get the tracer instance
 */
function getTracer(): WorkerTracer {
  return trace.getTracer('autotel-cloudflare-actors') as WorkerTracer;
}

/**
 * Instrument Actor alarms for tracing
 *
 * Captures:
 * - set: Schedule a single alarm
 * - setMultiple: Schedule multiple alarms
 * - cancel: Cancel an alarm
 * - cancelAll: Cancel all alarms
 */
export function instrumentActorAlarms(
  alarms: unknown,
  actorInstance: ActorLike,
  actorClass: object,
): unknown {
  if (!alarms || typeof alarms !== 'object') {
    return alarms;
  }

  const actorClassName = (actorClass as { name?: string }).name || 'Actor';
  const actorName = actorInstance.name || actorClassName;

  const alarmsHandler: ProxyHandler<object> = {
    get(target, prop) {
      const value = Reflect.get(target, prop);

      // Instrument set method
      if (prop === 'set' && typeof value === 'function') {
        return async function instrumentedSet(
          this: unknown,
          ...args: unknown[]
        ): Promise<unknown> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: alarms.set`;

          // Try to extract timing info from args
          const alarmAttributes: Record<string, string | number | boolean> = {
            'actor.name': actorName,
            'actor.class': actorClassName,
            'alarm.operation': 'set',
          };

          // First arg might be timestamp, delay, or options
          if (args.length > 0) {
            const firstArg = args[0];
            if (typeof firstArg === 'number') {
              alarmAttributes['alarm.delay_ms'] = firstArg;
            } else if (firstArg instanceof Date) {
              alarmAttributes['alarm.scheduled_time'] = firstArg.toISOString();
            } else if (typeof firstArg === 'string') {
              // Might be a cron expression
              alarmAttributes['alarm.cron'] = firstArg;
            }
          }

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: alarmAttributes,
            },
            async (span) => {
              try {
                const result = await value.apply(target, args);
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
        };
      }

      // Instrument setMultiple method
      if (prop === 'setMultiple' && typeof value === 'function') {
        return async function instrumentedSetMultiple(
          this: unknown,
          alarmDefs: unknown[],
        ): Promise<unknown> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: alarms.setMultiple`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'alarm.operation': 'setMultiple',
                'alarm.count': Array.isArray(alarmDefs) ? alarmDefs.length : 0,
              },
            },
            async (span) => {
              try {
                const result = await value.call(target, alarmDefs);
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
        };
      }

      // Instrument cancel method
      if (prop === 'cancel' && typeof value === 'function') {
        return async function instrumentedCancel(
          this: unknown,
          alarmId: string,
        ): Promise<unknown> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: alarms.cancel`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'alarm.operation': 'cancel',
                'alarm.id': alarmId,
              },
            },
            async (span) => {
              try {
                const result = await value.call(target, alarmId);
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
        };
      }

      // Instrument cancelAll method
      if (prop === 'cancelAll' && typeof value === 'function') {
        return async function instrumentedCancelAll(this: unknown): Promise<unknown> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: alarms.cancelAll`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'alarm.operation': 'cancelAll',
              },
            },
            async (span) => {
              try {
                const result = await value.call(target);
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
        };
      }

      // Bind other methods to the target
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  };

  return wrap(alarms, alarmsHandler);
}
