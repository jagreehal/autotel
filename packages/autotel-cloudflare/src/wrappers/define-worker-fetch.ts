/**
 * Ergonomic wrapper for Cloudflare Workers `fetch` handlers.
 *
 * `defineWorkerFetch` instruments the handler the same way `instrument()` does
 * (so span exports already flush via `ctx.waitUntil`), and additionally injects
 * a request-scoped `ExecutionLogger` as the fourth argument — pre-populated
 * with method, path, cf-ray and `request.cf` context.
 *
 * Use this instead of `wrapModule` / `instrument` when your handler wants the
 * logger handed in directly rather than reaching for `getRequestLogger()`.
 *
 * @example
 * ```ts
 * import { defineWorkerFetch } from 'autotel-cloudflare'
 *
 * export default defineWorkerFetch(
 *   { service: { name: 'my-worker' } },
 *   async (request, env, ctx, log) => {
 *     log.set({ route: '/health' })
 *     log.emitNow({ status: 200 })
 *     return new Response('ok')
 *   },
 * )
 * ```
 */
import type { ConfigurationOption } from 'autotel-edge';
import { instrument } from './instrument';
import { createWorkersLogger, type WorkersLoggerOptions } from '../execution-logger';
import type { ExecutionLogger } from '../execution-logger';

export type DefineWorkerFetchOptions = WorkersLoggerOptions;

export type WorkerFetchHandler<E> = (
  request: Request,
  env: E,
  ctx: ExecutionContext,
  log: ExecutionLogger,
) => Response | Promise<Response>;

/**
 * Wrap a Workers fetch handler so:
 *   - the handler is instrumented (spans, propagation, waitUntil export flush)
 *   - the handler receives a request-scoped logger as its fourth argument
 */
export function defineWorkerFetch<E = unknown>(
  config: ConfigurationOption,
  handler: WorkerFetchHandler<E>,
  loggerOptions: DefineWorkerFetchOptions = {},
): { fetch: (request: Request, env: E, ctx: ExecutionContext) => Promise<Response> } {
  const wrapped = instrument(
    {
      fetch(request: Request, env: E, ctx: ExecutionContext) {
        const log = createWorkersLogger(request, loggerOptions);
        return handler(request, env, ctx, log);
      },
    },
    config,
  );

  return {
    fetch(request, env, ctx) {
      return Promise.resolve(
        (wrapped.fetch as unknown as (
          req: Request,
          env: E,
          ctx: ExecutionContext,
        ) => Response | Promise<Response>)(request, env, ctx),
      );
    },
  };
}
