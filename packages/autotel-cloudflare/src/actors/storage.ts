/**
 * Actor storage instrumentation
 *
 * Traces operations on actor.storage including SQL queries
 */

import { SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap } from '../bindings/common';
import type { ActorLike } from './types';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import {
  asBoolean,
  asFunction,
  asRecord,
  asString,
  member,
} from '../values.js';

/**
 * Get the tracer instance
 */
function getTracer(): WorkerTracer {
  return workerTracer('autotel-cloudflare-actors');
}

/**
 * Instrument Actor storage for tracing
 *
 * Captures:
 * - SQL query operations
 * - Key-value operations (if available)
 */
export function instrumentActorStorage(
  storage: unknown,
  actorInstance: ActorLike,
  actorClass: object,
): unknown {
  // asRecord() returns the record rather than narrowing in place, so keep
  // what it handed back - that is the value the proxy wraps below.
  const storageRecord = asRecord(storage);
  if (!storageRecord) {
    return storage;
  }

  const actorClassName = asString(member(actorClass, 'name')) || 'Actor';
  const actorName = actorInstance.name || actorClassName;

  const storageHandler: ProxyHandler<object> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      // Instrument SQL query method if it exists
      // The Actors Storage class has an exec method for SQL
      if (prop === 'exec' && method) {
        return function instrumentedExec(
          this: unknown,
          query: string,
          ...params: unknown[]
        ): unknown {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.exec`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'sqlite',
                'db.operation': 'exec',
                'db.statement': query,
                'db.statement.params_count': params.length,
              },
            },
            (span) => {
              try {
                const result = method.call(target, query, ...params);
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
        };
      }

      // Instrument query method (alternative name for exec)
      if (prop === 'query' && method) {
        return function instrumentedQuery(
          this: unknown,
          query: string,
          ...params: unknown[]
        ): unknown {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.query`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'sqlite',
                'db.operation': 'query',
                'db.statement': query,
                'db.statement.params_count': params.length,
              },
            },
            (span) => {
              try {
                const result = method.call(target, query, ...params);
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
        };
      }

      // Instrument get method
      if (prop === 'get' && method) {
        return async function instrumentedGet(
          this: unknown,
          key: string,
        ): Promise<unknown> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.get`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'durable_object_storage',
                'db.operation': 'get',
                'db.key': key,
              },
            },
            async (span) => {
              try {
                const result = await method.call(target, key);
                span.setAttributes({
                  'db.result.found': result !== null && result !== undefined,
                });
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
        };
      }

      // Instrument put method
      if (prop === 'put' && method) {
        return async function instrumentedPut(
          this: unknown,
          key: string,
          val: unknown,
        ): Promise<void> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.put`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'durable_object_storage',
                'db.operation': 'put',
                'db.key': key,
                'db.value_type': typeof val,
              },
            },
            async (span) => {
              try {
                await method.call(target, key, val);
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
        };
      }

      // Instrument delete method
      if (prop === 'delete' && method) {
        return async function instrumentedDelete(
          this: unknown,
          key: string,
        ): Promise<unknown> {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: storage.delete`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'db.system': 'durable_object_storage',
                'db.operation': 'delete',
                'db.key': key,
              },
            },
            async (span) => {
              try {
                const result = await method.call(target, key);
                const deleted = asBoolean(result);
                if (deleted !== undefined) {
                  span.setAttributes({ 'db.result.deleted': deleted });
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
        };
      }

      // Bind other methods to the target
      return method ? method.bind(target) : value;
    },
  };

  return wrap(storageRecord, storageHandler);
}
