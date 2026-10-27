/**
 * Trace context a parent process handed down in environment variables.
 *
 * OpenTelemetry's environment-variable carrier: a process started with
 * `TRACEPARENT` (and optionally `TRACESTATE`, `BAGGAGE`) continues its
 * caller's trace. A batch job, a container task or a CLI run by a traced
 * parent gets a root span that is a child of the parent's span, instead of a
 * trace of its own. The parent sets it with
 * `{ TRACEPARENT: injectTraceContext().traceparent }` from `autotel/http`.
 *
 * Applies to the roots `trace()` and `span()` start when nothing is active.
 * Spans under an active span, and server spans that extract their own
 * headers, are untouched. `init({ traceContextFromEnv: false })` turns it off.
 */

import {
  ROOT_CONTEXT,
  propagation,
  trace,
  type Context,
} from '@opentelemetry/api';

let enabled = true;
let cachedKey: string | undefined;
let cached: Context | undefined;

/** Called by init(), which also registers the propagator the lookup needs. */
export function setTraceContextFromEnv(on: boolean): void {
  enabled = on;
  cachedKey = undefined;
  cached = undefined;
}

function contextFromEnv(): Context | undefined {
  const traceparent = process.env.TRACEPARENT?.trim();
  if (!enabled || !traceparent) return undefined;
  const tracestate = process.env.TRACESTATE?.trim();
  const baggage = process.env.BAGGAGE?.trim();
  const key = `${traceparent}|${tracestate ?? ''}|${baggage ?? ''}`;
  if (key !== cachedKey) {
    const carrier: Record<string, string> = { traceparent };
    if (tracestate) carrier.tracestate = tracestate;
    if (baggage) carrier.baggage = baggage;
    const extracted = propagation.extract(ROOT_CONTEXT, carrier);
    // A malformed value extracts nothing; start a trace of our own then.
    cached = trace.getSpanContext(extracted) ? extracted : undefined;
    cachedKey = key;
  }
  return cached;
}

/**
 * `ctx`, parented on the environment's trace context when nothing in `ctx` is
 * active. Baggage already in `ctx` wins over the environment's.
 */
export function withEnvParent(ctx: Context): Context {
  if (trace.getSpan(ctx)) return ctx;
  const fromEnv = contextFromEnv();
  if (!fromEnv) return ctx;
  const spanContext = trace.getSpanContext(fromEnv);
  if (!spanContext) return ctx;
  const withParent = trace.setSpanContext(ctx, spanContext);
  const envBaggage = propagation.getBaggage(fromEnv);
  return envBaggage && !propagation.getBaggage(ctx)
    ? propagation.setBaggage(withParent, envBaggage)
    : withParent;
}
