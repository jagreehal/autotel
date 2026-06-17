/**
 * Cloudflare native tracing adapter
 *
 * Bridges Cloudflare Workers' built-in custom-span API
 * (`ctx.tracing.enterSpan()` / `import { tracing } from "cloudflare:workers"`)
 * to autotel-edge's runtime-agnostic {@link NativeTracer} seam.
 *
 * When a Worker has tracing enabled (`observability.traces.enabled = true` in
 * Wrangler) the runtime exposes `ctx.tracing`. The handler wrappers detect it,
 * wrap it as a {@link NativeTracer}, and install it into the active context with
 * `withNativeTracer()`. From then on every autotel `span()` / `trace()` /
 * `enterSpan()` call — including deep inside utility functions and libraries —
 * automatically routes to Cloudflare's native tracer and nests inside the
 * platform's trace waterfall (fetch / KV / R2 / D1 / handler spans), exported
 * by Cloudflare to whichever destination is configured in Wrangler.
 *
 * No `cloudflare:workers` import is required here: the native tracer travels
 * through autotel's AsyncLocalStorage context, so code without access to `ctx`
 * still picks it up via `getActiveNativeTracer()`.
 */

import type { NativeTracer, NativeSpanHandle } from 'autotel-edge';

/**
 * Cloudflare's native custom-span surface. Declared locally because it is not
 * yet present in `@cloudflare/workers-types`. Structurally compatible with
 * autotel-edge's {@link NativeSpanHandle}.
 */
interface CloudflareSpan {
  readonly isTraced: boolean;
  setAttribute(key: string, value: string | number | boolean | undefined): void;
}

/**
 * Cloudflare's `tracing` object, available as `ctx.tracing` on the
 * ExecutionContext and as the `tracing` export of `cloudflare:workers`.
 */
interface CloudflareTracing {
  enterSpan<T, A extends unknown[]>(
    name: string,
    callback: (span: CloudflareSpan, ...args: A) => T,
    ...args: A
  ): T;
}

type MaybeTracingCarrier = { tracing?: CloudflareTracing } | null | undefined;

function readTracing(carrier: unknown): CloudflareTracing | undefined {
  const tracing = (carrier as MaybeTracingCarrier)?.tracing;
  return typeof tracing?.enterSpan === 'function' ? tracing : undefined;
}

/**
 * Returns `true` when Cloudflare native custom-span tracing is available on the
 * given ExecutionContext (i.e. tracing is enabled for this Worker).
 */
export function isNativeTracingAvailable(ctx: unknown): boolean {
  return readTracing(ctx) !== undefined;
}

/**
 * Wrap Cloudflare's `ctx.tracing` as an autotel {@link NativeTracer}, or return
 * `null` when native tracing is unavailable on this context.
 *
 * @param correlationId Optional per-request id (e.g. the `cf-ray` header)
 * surfaced as `ctx.correlationId` and a `correlation.id` span attribute, so
 * logs, custom spans, and the Cloudflare dashboard share one queryable key
 * today — before Cloudflare exposes in-code trace/span ids.
 */
export function getNativeTracerFromCtx(
  ctx: unknown,
  correlationId?: string,
): NativeTracer | null {
  const tracing = readTracing(ctx);
  if (!tracing) {
    return null;
  }
  return {
    correlationId,
    enterSpan: <T>(name: string, callback: (span: NativeSpanHandle) => T): T =>
      tracing.enterSpan(name, callback as (span: CloudflareSpan) => T),
  };
}
