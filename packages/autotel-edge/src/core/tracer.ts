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
  private readonly spanProcessors: TraceFlushableSpanProcessor[];
  private readonly resource: Resource;
  private headSampler: any; // Will be set via setHeadSampler

  constructor(spanProcessors: SpanProcessor[], resource: Resource) {
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
    if (options.root) {
      context = trace.deleteSpan(context);
    }

    if (!this.headSampler) {
      throw new Error(
        'Head sampler not configured. This is a bug in the instrumentation logic',
      );
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

    const sampleFlag =
      decision === SamplingDecision.RECORD_AND_SAMPLED ? 1 : 0; // TraceFlags.SAMPLED : TraceFlags.NONE
    const traceFlags = sampleFlag + randomTraceFlag;
    const spanContext: SpanContext = { traceId, spanId, traceFlags, traceState };

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

    const span = this.startSpan(name, options, parentContext);
    const contextWithSpanSet = trace.setSpan(parentContext, span);

    return api_context.with(contextWithSpanSet, fn, undefined, span);
  }
}

/**
 * Set attributes for the next span created
 */
export function withNextSpan(attrs: Attributes) {
  withNextSpanAttributes = Object.assign({}, withNextSpanAttributes, attrs);
}

function getTraceInfo(parentSpanContext?: SpanContext): {
  traceId: string;
  randomTraceFlag: NewTraceFlagValues;
} {
  if (parentSpanContext && trace.isSpanContextValid(parentSpanContext)) {
    const { traceId, traceFlags } = parentSpanContext;
    return { traceId, randomTraceFlag: getFlagAt(traceFlags, 2) as NewTraceFlagValues };
  } else {
    return {
      traceId: idGenerator.generateTraceId(),
      randomTraceFlag: NewTraceFlags.RANDOM_TRACE_ID_SET,
    };
  }
}
