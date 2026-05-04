# Adapter template

Annotated reference for a new autotel framework adapter. Replace `{name}` / `{Name}` / `{Framework}` consistently.

## `src/index.ts`

```typescript
/**
 * autotel-{name}
 *
 * Bring autotel into a {Framework} application.
 *
 * @example
 * ```ts
 * import { withAutotel, useLogger } from 'autotel-{name}'
 *
 * const app = new {Framework}()
 *   .use(withAutotel({ service: 'my-api' }))
 *   .get('/users/:id', (ctx) => {
 *     const log = useLogger()
 *     log.set({ user: { id: ctx.params.id } })
 *     return { ok: true }
 *   })
 * ```
 */
export { withAutotel } from './middleware'
export { useLogger } from './use-logger'
export { {name}Toolkit } from './toolkit'
export type { WithAutotelOptions } from './middleware'
```

## `src/toolkit.ts`

```typescript
import { createAdapterToolkit } from 'autotel-adapters'

export interface {Name}Context {
  method?: string
  path?: string
  context?: Record<string, unknown>
}

function enrichFromContext(ctx: {Name}Context): Record<string, unknown> | undefined {
  if (!ctx) return undefined
  const out: Record<string, unknown> = {}
  if (ctx.method) out['http.request.method'] = ctx.method
  if (ctx.path) out['http.route'] = ctx.path
  const reqId = ctx.context?.requestId
  if (typeof reqId === 'string') out['http.request.id'] = reqId
  return Object.keys(out).length > 0 ? out : undefined
}

export const {name}Toolkit = createAdapterToolkit<{Name}Context>({
  adapterName: '{name}',
  enrich: enrichFromContext,
})
```

## `src/use-logger.ts`

```typescript
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ExecutionLogger } from 'autotel'
import { {name}Toolkit } from './toolkit'

const storage = new AsyncLocalStorage<ExecutionLogger>()

/**
 * Resolve the request-scoped logger. Works without arguments inside a
 * request handler thanks to AsyncLocalStorage; falls back to creating a
 * new one if the framework hands you a context object.
 */
export function useLogger(ctx?: unknown): ExecutionLogger {
  const stored = storage.getStore()
  if (stored) return stored
  return {name}Toolkit.useLogger(ctx as never)
}

/** Internal: used by middleware to install the logger for the request scope. */
export function runWithLogger<T>(log: ExecutionLogger, fn: () => T): T {
  return storage.run(log, fn)
}
```

## `src/middleware.ts`

```typescript
import { trace } from 'autotel'
import type { ExecutionLogger } from 'autotel'
import { runWithLogger } from './use-logger'
import { {name}Toolkit, type {Name}Context } from './toolkit'

export interface WithAutotelOptions {
  /** Override span name. Default: `{name}.<method>`. */
  spanName?: string | ((ctx: {Name}Context) => string)
  /** Optional caller-side enrichment. */
  enrich?: (ctx: {Name}Context) => Record<string, unknown> | undefined
}

/**
 * Wrap a {Framework} handler so that:
 *   - a span is started + ended around the handler
 *   - the handler error (if any) is recorded onto the span
 *   - useLogger() works anywhere within the handler scope
 */
export function withAutotel<TCtx extends {Name}Context, TResult>(
  options: WithAutotelOptions = {},
): (handler: (ctx: TCtx) => TResult | Promise<TResult>) => (ctx: TCtx) => Promise<TResult> {
  return (handler) => async (ctx) => {
    const spanName =
      typeof options.spanName === 'function'
        ? options.spanName(ctx)
        : (options.spanName ?? `{name}.${ctx.method ?? 'request'}`)

    const wrapped = trace({ name: spanName }, (traceCtx) => async (innerCtx: TCtx) => {
      const log = {name}Toolkit.useLogger(innerCtx)
      const extra = options.enrich?.(innerCtx)
      if (extra && Object.keys(extra).length > 0) {
        log.set(extra)
      }
      return runWithLogger(log, () => handler(innerCtx))
    })

    return wrapped(ctx)
  }
}
```
