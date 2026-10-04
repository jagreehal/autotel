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
 * Code outside any wrapper (Durable Object RPC methods, entrypoints, helpers)
 * falls back to the module-level `tracing` export of `cloudflare:workers`,
 * registered below as autotel-edge's default native tracer.
 */

import { tracing as moduleTracing } from 'cloudflare:workers';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  WorkerTracerProvider,
  setDefaultNativeTracer,
  type NativeTracer,
  type NativeSpanHandle,
} from 'autotel-edge';

/**
 * Cloudflare's native custom-span surface. Declared locally so we don't depend
 * on `@cloudflare/workers-types`. Older runtimes only have `isTraced` +
 * `setAttribute`; the rest (Sept 2026+) are picked up by the bridge when present.
 */
type CloudflareSpan = NativeSpanHandle;

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
  getActiveSpan?(): CloudflareSpan | undefined;
  /** Sept 2026+: a span the caller ends, not made active. Takes a name only. */
  startSpan?(name: string): CloudflareSpan;
  /** Sept 2026+: active for the callback; the caller ends it. */
  startActiveSpan?<T>(name: string, callback: (span: CloudflareSpan) => T): T;
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
    getActiveSpan: () => tracing.getActiveSpan?.(),
    // Older runtimes lack these; autotel-edge's tracer falls back to enterSpan.
    startSpan: tracing.startSpan && ((name) => tracing.startSpan!(name)),
    startActiveSpan:
      tracing.startActiveSpan &&
      ((name, callback) => tracing.startActiveSpan!(name, callback)),
  };
}

/**
 * The isolate-wide native tracer from `cloudflare:workers`, or `null` when the
 * runtime has no tracing API. Registered as the default so `trace()`/`span()`
 * nest in the platform waterfall even where no wrapper installed one.
 */
export const platformNativeTracer = getNativeTracerFromCtx({
  tracing: moduleTracing,
});
setDefaultNativeTracer(platformNativeTracer);

// Register autotel's tracer so OpenTelemetry API spans (AI SDK telemetry,
// instrumentation libraries) route to the native tracer. An OTLP-mode
// invocation reconfigures this same tracer.
if (platformNativeTracer) {
  new WorkerTracerProvider([], resourceFromAttributes({})).register();
}
