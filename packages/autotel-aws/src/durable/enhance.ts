/**
 * Additions to AWS's OpenTelemetry plugins for durable functions
 * (`@aws/durable-execution-sdk-js-otel`). They emit the spans; these fill the
 * gaps when autotel owns the tracer provider.
 */

import { flush } from 'autotel';
import type { DurableInstrumentationPluginFactory } from '@aws/durable-execution-sdk-js';
import {
  xRayContextExtractor,
  type ContextExtractor,
} from '@aws/durable-execution-sdk-js-otel';
import { invokerSpanContext } from './context';

/**
 * Flushes autotel at the end of every invocation, before Lambda freezes the
 * environment: queued events, spans, logs and metrics. AWS's plugin flushes its spans
 * itself. The SDK starts `onInvocationEnd` hooks in registration order but
 * awaits them together, so this may overlap AWS's flush: it relies on no
 * order between them.
 */
export function durableFlush(): DurableInstrumentationPluginFactory {
  return {
    createPlugin: () => ({
      async onInvocationEnd() {
        // Telemetry never fails the invocation.
        await flush().catch(() => {});
      },
    }),
  };
}

/**
 * A `contextExtractor` for AWS's plugins when autotel decides what to sample.
 *
 * - An execution started by `ctx.invoke()` with a `withInvokeTraceContext()`
 *   payload joins the caller's trace and keeps the caller's decision.
 * - Any other execution keeps the trace and parent from Lambda's X-Ray header
 *   and leaves sampling to autotel's sampler. Lambda sends `Sampled=0` unless
 *   X-Ray active tracing is on.
 */
export const autotelContextExtractor: ContextExtractor = (info) => {
  const caller = invokerSpanContext(info.executionInput);
  if (caller) {
    return {
      traceId: caller.traceId,
      parentSpanId: caller.spanId,
      traceFlags: caller.traceFlags,
    };
  }
  const xray = xRayContextExtractor(info);
  return xray && { ...xray, traceFlags: undefined, sampling: 'UNDECIDED' };
};
