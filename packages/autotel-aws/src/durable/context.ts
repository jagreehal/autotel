/**
 * Trace context for durable executions, where AWS's OpenTelemetry plugins
 * leave the edges: a consumer of status-change events, and an execution
 * started by `ctx.invoke()`.
 */

import { context, trace, TraceFlags } from '@opentelemetry/api';
import type { Context, SpanContext } from '@opentelemetry/api';
import {
  GetDurableExecutionCommand,
  LambdaClient,
} from '@aws-sdk/client-lambda';
import {
  deriveExecutionRootSpanId,
  deriveTraceIdFromArn,
  deriveTraceIdFromXRayRoot,
} from '@aws/durable-execution-sdk-js-otel';

/**
 * The `Durable Execution Status Change` event Lambda publishes to EventBridge.
 * `endTimestamp` is present for terminal states only.
 */
export interface DurableExecutionStatusChangeEvent {
  source: 'aws.lambda';
  'detail-type': 'Durable Execution Status Change';
  detail: {
    durableExecutionArn: string;
    durableExecutionName: string;
    functionArn: string;
    status: 'RUNNING' | 'SUCCEEDED' | 'STOPPED' | 'FAILED' | 'TIMED_OUT';
    startTimestamp: string;
    endTimestamp?: string;
  };
}

export function isDurableExecutionStatusChange(
  event: unknown,
): event is DurableExecutionStatusChangeEvent {
  const e = event as Partial<DurableExecutionStatusChangeEvent> | undefined;
  return (
    e?.source === 'aws.lambda' &&
    e['detail-type'] === 'Durable Execution Status Change' &&
    typeof e.detail?.durableExecutionArn === 'string'
  );
}

let defaultClient: LambdaClient | undefined;

/**
 * The execution's trace, for a Lambda consuming its status-change events: run
 * the handler inside it and its spans join the execution's. The event names the
 * execution but not its trace, so this reads what Lambda stored with it
 * (`lambda:GetDurableExecution`) and resolves the parent the way
 * `autotelContextExtractor` did when the execution ran: the caller's context
 * from a `withInvokeTraceContext()` input, else the X-Ray header, else the IDs
 * AWS's plugins derive from the ARN.
 *
 * Sampled, whatever the header says: Lambda marks executions without active
 * tracing `Sampled=0`, and the consumer is code you chose to trace.
 */
export async function durableExecutionContext(
  event: DurableExecutionStatusChangeEvent,
  client: Pick<LambdaClient, 'send'> = (defaultClient ??= new LambdaClient({})),
): Promise<Context> {
  const { durableExecutionArn: arn, startTimestamp } = event.detail;
  const execution = await client.send(
    new GetDurableExecutionCommand({ DurableExecutionArn: arn }),
  );
  const parent = (traceId: string, spanId: string) =>
    trace.setSpanContext(context.active(), {
      traceId,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });

  const caller = invokerSpanContext(parseJson(execution.InputPayload));
  if (caller) return parent(caller.traceId, caller.spanId);

  const header = execution.TraceHeader?.XAmznTraceId ?? '';
  const root = /Root=([^;]+)/.exec(header)?.[1];
  const traceId = root && deriveTraceIdFromXRayRoot(root);
  const spanId = /Parent=([\da-f]{16})/.exec(header)?.[1];
  if (traceId && spanId) return parent(traceId, spanId);

  return parent(
    traceId || deriveTraceIdFromArn(arn, new Date(startTimestamp)),
    deriveExecutionRootSpanId(arn),
  );
}

/** The stored input, or undefined when it is absent or not JSON. */
function parseJson(payload: string | undefined): unknown {
  try {
    return payload === undefined ? undefined : JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/** The payload field that carries trace context, shared with Step Functions. */
export interface InvokeTraceContext {
  _traceContext?: { traceparent: string; tracestate?: string };
}

/**
 * Adds the active trace context to a `ctx.invoke()` payload. The invoked
 * function's execution would otherwise start a trace of its own; a durable
 * target whose AWS plugin uses `autotelContextExtractor` joins the caller's
 * trace instead, its workflow under the span that made the call.
 * A plain Lambda target joins the caller's trace with
 * `wrapHandler(fn, { extractTraceContext: (e) => e._traceContext })`.
 *
 * Called again on every replay, but the SDK sends the payload only when the
 * invoke first starts.
 */
export function withInvokeTraceContext<T extends object>(
  payload: T,
): T & InvokeTraceContext {
  // Written as W3C directly: the reader is our own extractor, whatever
  // propagator the app registered.
  const span = trace.getSpanContext(context.active());
  if (!span || !trace.isSpanContextValid(span)) return payload;
  const flags = span.traceFlags.toString(16).padStart(2, '0');
  return {
    ...payload,
    _traceContext: {
      traceparent: `00-${span.traceId}-${span.spanId}-${flags}`,
      ...(span.traceState && { tracestate: span.traceState.serialize() }),
    },
  };
}

/** The caller's span context from a payload built by `withInvokeTraceContext`. */
export function invokerSpanContext(input: unknown): SpanContext | undefined {
  // SAFETY: optional chaining reads the field only when input has one.
  const traceparent = (input as InvokeTraceContext | null)?._traceContext
    ?.traceparent;
  const match = /^00-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/.exec(
    traceparent ?? '',
  );
  if (!match) return undefined;
  const span: SpanContext = {
    traceId: match[1]!,
    spanId: match[2]!,
    traceFlags: Number.parseInt(match[3]!, 16),
    isRemote: true,
  };
  return trace.isSpanContextValid(span) ? span : undefined;
}
