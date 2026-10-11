/**
 * Additions to AWS's OpenTelemetry plugins for durable functions
 * (`@aws/durable-execution-sdk-js-otel`). They emit the spans; these fill the
 * gaps when autotel owns the tracer provider.
 */

import { flush } from 'autotel';
import type { DurableInstrumentationPlugin } from '@aws/durable-execution-sdk-js';
import {
  xRayContextExtractor,
  type ContextExtractor,
} from '@aws/durable-execution-sdk-js-otel';
import { invokerSpanContext } from './context';

/**
 * Flushes autotel at the end of every invocation, before Lambda freezes the
 * environment. AWS's plugins flush a provider they hold directly; under
 * `init()` they hold the global proxy, so autotel flushes its own. List it
 * after AWS's plugin: that plugin ends its spans inside the invocation.
 */
export function durableFlush(): DurableInstrumentationPlugin {
  return {
    async wrapInvocation(_info, fn) {
      try {
        return await fn();
      } finally {
        // Telemetry never fails the invocation.
        await flush().catch(() => {});
      }
    },
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
