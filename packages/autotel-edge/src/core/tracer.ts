/**
 * Lightweight WorkerTracer for edge environments
 */

import type {
  Attributes,
  Tracer,
  Span,
  SpanKind,
  SpanOptions,
  Context,
} from '@opentelemetry/api';
import {
  context as api_context,
  INVALID_SPAN_CONTEXT,
  trace,
  type SpanContext,
} from '@opentelemetry/api';
import { sanitizeAttributes } from '@opentelemetry/core';
import type { Resource } from '@opentelemetry/resources';
import {
  type SpanProcessor,
  RandomIdGenerator,
  type ReadableSpan,
  SamplingDecision,
} from '@opentelemetry/sdk-trace-base';

import { SpanImpl } from './span';
import type { TraceFlushableSpanProcessor } from '../types';
import {
  applyNativeAttributes,
  createNativeSpanShim,
  getActiveNativeTracer,
  type NativeSpanHandle,
  type NativeTracer,
} from './native-bridge';

const NewTraceFlags = {
  RANDOM_TRACE_ID_SET: 2,
  RANDOM_TRACE_ID_UNSET: 0,
} as const;

type NewTraceFlagValues =
  | typeof NewTraceFlags.RANDOM_TRACE_ID_SET
  | typeof NewTraceFlags.RANDOM_TRACE_ID_UNSET;

const idGenerator: RandomIdGenerator = new RandomIdGenerator();

let withNextSpanAttributes: Attributes;

function getFlagAt(flagSequence: number, position: number): number {
  return ((flagSequence >> (position - 1)) & 1) * position;
}

/**
 * WorkerTracer - Lightweight tracer for edge environments
 */
export class WorkerTracer implements Tracer {
  private spanProcessors: TraceFlushableSpanProcessor[];
  private resource: Resource;
  private headSampler: any; // Will be set via setHeadSampler

  constructor(spanProcessors: SpanProcessor[], resource: Resource) {
    this.spanProcessors = spanProcessors as TraceFlushableSpanProcessor[];
    this.resource = resource;
  }

  /**
   * Swap in the OTLP pipeline. The global provider can only be registered once
   * per isolate, so a later registration reconfigures the tracer already there.
   */
  configure(spanProcessors: SpanProcessor[], resource: Resource): void {
    this.spanProcessors = spanProcessors as TraceFlushableSpanProcessor[];
    this.resource = resource;
  }

  /**
   * Set the head sampler (called from config)
   */
  setHeadSampler(sampler: any): void {
    this.headSampler = sampler;
  }

  /**
   * Force flush spans for a specific trace
   */
  async forceFlush(traceId?: string) {
    const promises = this.spanProcessors.map(async (spanProcessor) => {
      await spanProcessor.forceFlush(traceId);
    });
    await Promise.allSettled(promises);
  }

  /**
   * Add extra resource attributes
   */
  addToResource(extra: Resource) {
    this.resource.merge(extra);
  }

  /**
   * Start a new span
   */
  startSpan(
    name: string,
    options: SpanOptions = {},
    context = api_context.active(),
  ): Span {
    // Under a platform tracer, OpenTelemetry API spans join the native waterfall.
    const native = getActiveNativeTracer();
    if (native) {
      return startNativeSpan(native, name, options);
    }

    if (options.root) {
      context = trace.deleteSpan(context);
    }

    // Registered for native routing, with no OTLP pipeline configured.
    if (!this.headSampler) {
      return trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
    }

    const parentSpanContext = trace.getSpan(context)?.spanContext();
    const { traceId, randomTraceFlag } = getTraceInfo(parentSpanContext);

    const spanKind = options.kind || (0 as SpanKind); // SpanKind.INTERNAL
    const sanitisedAttrs = sanitizeAttributes(options.attributes);

    // Use per-span sampler if provided, otherwise use head sampler
    const optionsWithSampler = options as any;
    const sampler = optionsWithSampler.sampler || this.headSampler;

    const samplingDecision = sampler.shouldSample(
      context,
      traceId,
      name,
      spanKind,
      sanitisedAttrs,
      [],
    );
    const { decision, traceState, attributes: attrs } = samplingDecision;

    const attributes = Object.assign(
      {},
      options.attributes,
      attrs,
      withNextSpanAttributes,
    );
    withNextSpanAttributes = {};

    const spanId = idGenerator.generateSpanId();
    const parentSpanId = parentSpanContext?.spanId;

    const sampleFlag = decision === SamplingDecision.RECORD_AND_SAMPLED ? 1 : 0; // TraceFlags.SAMPLED : TraceFlags.NONE
    const traceFlags = sampleFlag + randomTraceFlag;
    const spanContext: SpanContext = {
      traceId,
      spanId,
      traceFlags,
      traceState,
    };

    const span = new SpanImpl({
      attributes: sanitizeAttributes(attributes),
      name,
      onEnd: (span) => {
        for (const sp of this.spanProcessors) {
          sp.onEnd(span as unknown as ReadableSpan);
        }
      },
      resource: this.resource,
      spanContext,
      parentSpanContext,
      parentSpanId,
      spanKind,
      startTime: options.startTime,
    });

    for (const sp of this.spanProcessors) {
      //@ts-ignore - OTel type quirk
      sp.onStart(span, context);
    }

    return span;
  }

  /**
   * Start an active span (with automatic context management)
   */
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    name: string,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    name: string,
    options: SpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    name: string,
    ...args: unknown[]
  ): ReturnType<F> {
    const options = args.length > 1 ? (args[0] as SpanOptions) : undefined;
    const parentContext =
      args.length > 2 ? (args[1] as Context) : api_context.active();
    const fn = args.at(-1) as F;

    const native = getActiveNativeTracer();
    if (native) {
      return startActiveNativeSpan(native, name, options, fn);
    }

    const span = this.startSpan(name, options, parentContext);
    const contextWithSpanSet = trace.setSpan(parentContext, span);

    return api_context.with(contextWithSpanSet, fn, undefined, span);
  }
}

function nativeShim(
  native: NativeTracer,
  handle: NativeSpanHandle,
  options: SpanOptions | undefined,
  owned: boolean,
): Span {
  // Cloudflare's startSpan takes a name only, so attributes go on afterwards.
  if (options?.attributes) applyNativeAttributes(handle, options.attributes);
  return createNativeSpanShim(handle, native.correlationId, owned);
}

/**
 * OpenTelemetry `startSpan` on a native tracer. The span nests under the
 * platform's active span; parent context, `root`, kind and links have no
 * native equivalent. A runtime without `startSpan` gets a non-recording span.
 */
function startNativeSpan(
  native: NativeTracer,
  name: string,
  options: SpanOptions,
): Span {
  if (!native.startSpan) {
    return trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
  }
  return nativeShim(native, native.startSpan(name), options, true);
}

/**
 * OpenTelemetry `startActiveSpan` on a native tracer: platform operations and
 * child spans inside `fn` nest under this span. Falls back to `enterSpan` on
 * runtimes without `startActiveSpan`; that span ends itself when `fn` settles.
 */
function startActiveNativeSpan<F extends (span: Span) => ReturnType<F>>(
  native: NativeTracer,
  name: string,
  options: SpanOptions | undefined,
  fn: F,
): ReturnType<F> {
  if (native.startActiveSpan) {
    return native.startActiveSpan(name, (handle) =>
      fn(nativeShim(native, handle, options, true)),
    );
  }
  return native.enterSpan(name, (handle) =>
    fn(nativeShim(native, handle, options, false)),
  );
}

/**
 * Set attributes for the next span created
 */
export function withNextSpan(attrs: Attributes) {
  withNextSpanAttributes = Object.assign({}, withNextSpanAttributes, attrs);
}

/** What getTraceInfo() answers with. */
interface GetTraceInfoResult {
  traceId: string;
  randomTraceFlag: NewTraceFlagValues;
}

function getTraceInfo(parentSpanContext?: SpanContext): GetTraceInfoResult {
  if (parentSpanContext && trace.isSpanContextValid(parentSpanContext)) {
    const { traceId, traceFlags } = parentSpanContext;
    return {
      traceId,
      randomTraceFlag: getFlagAt(traceFlags, 2) as NewTraceFlagValues,
    };
  } else {
    return {
      traceId: idGenerator.generateTraceId(),
      randomTraceFlag: NewTraceFlags.RANDOM_TRACE_ID_SET,
    };
  }
}
