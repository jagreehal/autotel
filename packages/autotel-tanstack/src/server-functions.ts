import { SpanStatusCode } from '@opentelemetry/api';
import { trace, type TraceContext } from 'autotel';
import { isServerSide } from './env';
import { type TraceServerFnConfig, SPAN_ATTRIBUTES } from './types';

/**
 * Wrap a TanStack server function with OpenTelemetry tracing
 *
 * This function wraps a server function to automatically create spans
 * for each invocation. It captures function name, arguments (optionally),
 * results (optionally), and errors.
 *
 * @param serverFn - The server function to wrap
 * @param config - Configuration options
 * @returns Wrapped server function with tracing
 *
 * @example
 * ```typescript
 * import { createServerFn } from '@tanstack/react-start';
 * import { traceServerFn } from 'autotel-tanstack/server-functions';
 *
 * const getUserBase = createServerFn({ method: 'GET' })
 *   .handler(async ({ data: id }) => {
 *     return await db.users.findUnique({ where: { id } });
 *   });
 *
 * export const getUser = traceServerFn(getUserBase, { name: 'getUser' });
 * ```
 *
 * @example
 * ```typescript
 * // With argument and result capture (careful with PII!)
 * export const createUser = traceServerFn(
 *   createServerFn({ method: 'POST' })
 *     .handler(async ({ data }) => {
 *       return await db.users.create({ data });
 *     }),
 *   {
 *     name: 'createUser',
 *     captureArgs: true,
 *     captureResults: false, // Don't capture for PII reasons
 *   }
 * );
 * ```
 */
export function traceServerFn<T extends (...args: any[]) => any>(
  serverFn: T,
  config: TraceServerFnConfig = {},
): T {
  const fnName = config.name || serverFn.name || 'serverFn';
  const captureArgs = config.captureArgs ?? true;
  const captureResults = config.captureResults ?? false;

  return new Proxy(serverFn, {
    apply(target, thisArg, argArray) {
      // If we're in the browser, just call the function without tracing
      // Server functions should never run in the browser, but this prevents
      // autotel (which uses Node.js APIs) from being executed if it somehow does
      if (!isServerSide()) {
        return target.apply(thisArg, argArray);
      }

      return trace(`tanstack.serverFn.${fnName}`, async (ctx: TraceContext) => {
        ctx.setAttributes({
          [SPAN_ATTRIBUTES.RPC_SYSTEM]: 'tanstack-start',
          [SPAN_ATTRIBUTES.RPC_METHOD]: fnName,
          [SPAN_ATTRIBUTES.TANSTACK_TYPE]: 'serverFn',
          [SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_NAME]: fnName,
        });

        // Capture arguments if configured
        if (captureArgs && argArray.length > 0) {
          const args = argArray[0];
          if (args !== undefined) {
            try {
              ctx.setAttribute(
                SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_ARGS,
                JSON.stringify(args),
              );
            } catch {
              ctx.setAttribute(
                SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_ARGS,
                '[non-serializable]',
              );
            }
          }
        }

        try {
          const result = await Reflect.apply(target, thisArg, argArray);

          // Capture result if configured
          if (captureResults && result !== undefined) {
            try {
              ctx.setAttribute(
                SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_RESULT,
                JSON.stringify(result),
              );
            } catch {
              ctx.setAttribute(
                SPAN_ATTRIBUTES.TANSTACK_SERVER_FN_RESULT,
                '[non-serializable]',
              );
            }
          }

          ctx.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          ctx.recordException(error as Error);
          ctx.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message,
          });
          throw error;
        }
      });
    },

    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

/**
 * Create a traced version of createServerFn
 *
 * This higher-order function wraps TanStack's createServerFn to automatically
 * add tracing to all created server functions.
 *
 * @param createServerFnOriginal - The original createServerFn from TanStack
 * @param defaultConfig - Default configuration for all server functions
 * @returns Wrapped createServerFn that produces traced server functions
 *
 * @example
 * ```typescript
 * import { createServerFn as originalCreateServerFn } from '@tanstack/react-start';
 * import { createTracedServerFnFactory } from 'autotel-tanstack/server-functions';
 *
 * export const createServerFn = createTracedServerFnFactory(originalCreateServerFn);
 *
 * // Now all server functions created with createServerFn are automatically traced
 * export const getUser = createServerFn({ method: 'GET' })
 *   .handler(async ({ data: id }) => {
 *     return await db.users.findUnique({ where: { id } });
 *   });
 * ```
 */
export function createTracedServerFnFactory<
  TCreateServerFn extends (...args: any[]) => any,
>(
  createServerFnOriginal: TCreateServerFn,
  defaultConfig: Omit<TraceServerFnConfig, 'name'> = {},
): TCreateServerFn {
  return new Proxy(createServerFnOriginal, {
    apply(target, thisArg, argArray) {
      const result = Reflect.apply(target, thisArg, argArray);

      // If the result has a .handler method, wrap it
      if (
        result &&
        typeof result === 'object' &&
        'handler' in result &&
        typeof result.handler === 'function'
      ) {
        const originalHandler = result.handler.bind(result);

        result.handler = function tracedHandler(handlerFn: unknown) {
          const wrappedHandler = originalHandler(handlerFn as never);

          // Try to infer function name from the handler
          const fnName = (handlerFn as { name?: string })?.name || 'serverFn';

          return traceServerFn(wrappedHandler, {
            ...defaultConfig,
            name: fnName,
          });
        };
      }

      return result;
    },
  }) as TCreateServerFn;
}
