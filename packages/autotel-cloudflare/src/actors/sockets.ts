/**
 * Actor sockets instrumentation
 *
 * Traces operations on actor.sockets
 */

import { SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { WorkerTracer } from 'autotel-edge';
import { wrap } from '../bindings/common';
import type { ActorLike } from './types';
import { toException } from '../exception.js';
import { workerTracer } from '../tracer.js';
import { asFunction, asRecord, asString, member } from '../values.js';

/**
 * Get the tracer instance
 */
function getTracer(): WorkerTracer {
  return workerTracer('autotel-cloudflare-actors');
}

/**
 * Instrument Actor sockets for tracing
 *
 * Captures:
 * - acceptWebSocket: Accept an incoming WebSocket connection
 * - broadcast: Send message to all connected sockets
 * - send: Send message to a specific socket
 */
export function instrumentActorSockets(
  sockets: unknown,
  actorInstance: ActorLike,
  actorClass: object,
): unknown {
  // asRecord() returns the record rather than narrowing in place, so keep
  // what it handed back - that is the value the proxy wraps below.
  const socketsRecord = asRecord(sockets);
  if (!socketsRecord) {
    return sockets;
  }

  const actorClassName = asString(member(actorClass, 'name')) || 'Actor';
  const actorName = actorInstance.name || actorClassName;

  const socketsHandler: ProxyHandler<object> = {
    get(target, prop) {
      const value = member(target, prop);
      const method = asFunction(value);

      // Instrument acceptWebSocket method
      if (prop === 'acceptWebSocket' && method) {
        return function instrumentedAcceptWebSocket(
          this: unknown,
          request: Request,
        ): unknown {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: sockets.acceptWebSocket`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.SERVER,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'websocket.operation': 'accept',
                'url.full': request.url,
              },
            },
            (span) => {
              try {
                const result = method.call(target, request);
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

      // Instrument broadcast method
      if (prop === 'broadcast' && method) {
        return function instrumentedBroadcast(
          this: unknown,
          message: unknown,
        ): void {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: sockets.broadcast`;

          tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.PRODUCER,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'websocket.operation': 'broadcast',
                'websocket.message.type': typeof message,
                'websocket.message.size':
                  typeof message === 'string'
                    ? message.length
                    : message instanceof ArrayBuffer
                      ? message.byteLength
                      : 0,
              },
            },
            (span) => {
              try {
                method.call(target, message);
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

      // Instrument send method
      if (prop === 'send' && method) {
        return function instrumentedSend(
          this: unknown,
          ws: WebSocket,
          message: unknown,
        ): void {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: sockets.send`;

          tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.PRODUCER,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'websocket.operation': 'send',
                'websocket.message.type': typeof message,
                'websocket.message.size':
                  typeof message === 'string'
                    ? message.length
                    : message instanceof ArrayBuffer
                      ? message.byteLength
                      : 0,
              },
            },
            (span) => {
              try {
                method.call(target, ws, message);
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

      // Instrument getConnections method (if exists)
      if (prop === 'getConnections' && method) {
        return function instrumentedGetConnections(this: unknown): unknown {
          const tracer = getTracer();
          const spanName = `Actor ${actorName}: sockets.getConnections`;

          return tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.CLIENT,
              attributes: {
                'actor.name': actorName,
                'actor.class': actorClassName,
                'websocket.operation': 'getConnections',
              },
            },
            (span) => {
              try {
                const result = method.call(target);
                // Try to capture connection count if result is array-like
                if (Array.isArray(result)) {
                  span.setAttribute(
                    'websocket.connections.count',
                    result.length,
                  );
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

  return wrap(socketsRecord, socketsHandler);
}
