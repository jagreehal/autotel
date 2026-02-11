/**
 * SentrySpanProcessor: converts OpenTelemetry spans to Sentry transactions/spans.
 * Register with init({ spanProcessors: [new SentrySpanProcessor(Sentry)] }).
 */

import { trace } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';
import type { Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import {
  convertOtelTimeToSeconds,
  getTraceData,
  isSentryRequestSpan,
  updateSpanWithOtelData,
  updateTransactionWithOtelData,
  finishTransactionWithContextFromOtelData,
  generateSentryErrorsFromOtelSpan,
} from './helpers';

/** Minimal Sentry hub interface for creating transactions and spans. */
export interface SentryHubLike {
  startTransaction(ctx: SentryTransactionContextLike): SentryTransactionLike | undefined;
  getSpan(): SentrySpanLike | undefined;
}

/** Context passed to startTransaction. */
export interface SentryTransactionContextLike {
  name: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  startTimestamp?: number;
  instrumenter?: string;
}

/** Sentry transaction (root span). */
export interface SentryTransactionLike {
  startChild(ctx: SentrySpanContextLike): SentrySpanLike;
  setStatus(s: { status?: string }): void;
  setContext(name: string, ctx: Record<string, unknown>): void;
  finish(endTime?: number): void;
  name?: string;
  op?: string;
}

/** Context passed to startChild. */
export interface SentrySpanContextLike {
  description?: string;
  instrumenter?: string;
  startTimestamp?: number;
  spanId?: string;
}

/** Sentry span (child or transaction). */
export interface SentrySpanLike {
  setStatus(s: { status?: string }): void;
  setData(key: string, value: unknown): void;
  finish(endTime?: number): void;
  op?: string;
  description?: string;
}

/** Minimal Sentry SDK interface used by the processor. */
export interface SentryLike {
  getCurrentHub(): SentryHubLike;
  addGlobalEventProcessor(callback: (event: unknown) => unknown): void;
  captureException(error: Error, options?: { contexts?: Record<string, unknown> }): void;
}

/** Client with getDsn() for isSentryRequest detection. */
interface SentryClientLike {
  getDsn(): { host: string } | undefined;
}

const INSTRUMENTER_OTEL = 'otel';

export class SentrySpanProcessor implements SpanProcessor {
  private readonly sentry: SentryLike;
  private readonly map = new Map<string, SentrySpanLike | SentryTransactionLike>();

  constructor(sentry: SentryLike) {
    this.sentry = sentry;

    if (typeof sentry.addGlobalEventProcessor === 'function') {
      sentry.addGlobalEventProcessor((event: unknown) => {
        const e = event as { contexts?: Record<string, unknown> };
        const otelSpan = trace.getActiveSpan();
        if (!otelSpan) return e;

        if (e.contexts && (e.contexts as Record<string, unknown>).trace) {
          return e;
        }

        const ctx = otelSpan.spanContext();
        e.contexts = {
          ...e.contexts,
          trace: {
            trace_id: ctx.traceId,
            span_id: ctx.spanId,
          },
        };
        return e;
      });
    }
  }

  private getDsnHost(): string | undefined {
    const hub = this.sentry.getCurrentHub();
    const client = (hub as unknown as { getClient?(): SentryClientLike }).getClient?.();
    return client?.getDsn()?.host;
  }

  onStart(span: Span, _parentContext: Context): void {
    const hub = this.sentry.getCurrentHub();
    if (!hub) return;

    const spanContext = span.spanContext();
    const otelSpanId = spanContext.spanId;
    const parentSpanId = span.parentSpanContext?.spanId;
    const parentSentry = parentSpanId ? this.map.get(parentSpanId) : undefined;

    const startTimestamp = convertOtelTimeToSeconds(span.startTime);

    if (parentSentry && 'startChild' in parentSentry) {
      const child = parentSentry.startChild({
        description: span.name,
        instrumenter: INSTRUMENTER_OTEL,
        startTimestamp,
        spanId: otelSpanId,
      });
      this.map.set(otelSpanId, child);
    } else {
      const traceData = getTraceData(span as unknown as ReadableSpan);
      const transaction = hub.startTransaction({
        name: span.name,
        traceId: traceData.traceId,
        spanId: traceData.spanId,
        parentSpanId: traceData.parentSpanId,
        startTimestamp,
        instrumenter: INSTRUMENTER_OTEL,
      });
      if (transaction) {
        this.map.set(otelSpanId, transaction);
      }
    }
  }

  onEnd(span: ReadableSpan): void {
    const otelSpanId = span.spanContext().spanId;
    const sentrySpan = this.map.get(otelSpanId);

    if (isSentryRequestSpan(span, () => this.getDsnHost())) {
      this.map.delete(otelSpanId);
      return;
    }

    generateSentryErrorsFromOtelSpan(span, (err, opts) =>
      this.sentry.captureException(err, opts),
    );

    if (!sentrySpan) return;

    const isTransaction = 'setContext' in sentrySpan && 'finish' in sentrySpan;

    if (isTransaction) {
      updateTransactionWithOtelData(sentrySpan as SentryTransactionLike, span);
      finishTransactionWithContextFromOtelData(
        sentrySpan as SentryTransactionLike,
        span,
      );
    } else {
      updateSpanWithOtelData(sentrySpan as SentrySpanLike, span);
      sentrySpan.finish(convertOtelTimeToSeconds(span.endTime));
    }

    this.map.delete(otelSpanId);
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.map.clear();
    return Promise.resolve();
  }
}

export function createSentrySpanProcessor(sentry: SentryLike): SentrySpanProcessor {
  return new SentrySpanProcessor(sentry);
}
