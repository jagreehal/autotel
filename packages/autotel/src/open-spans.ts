/**
 * Spans still running when the process is stopped.
 *
 * A job killed by SIGTERM (a Batch timeout, a deploy, a scale-in) or by an
 * uncaught error never reaches the code that ends its spans. Its root stays
 * open, so the tail sampler has no outcome to judge and the backend gets
 * children with no job span above them. `processHandlers` ends these first,
 * marked failed, so the trace arrives whole and is kept as an error.
 */

import { SpanStatusCode } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

export class OpenSpanTracker implements SpanProcessor {
  private readonly open = new Set<Span>();

  onStart(span: Span): void {
    this.open.add(span);
  }

  onEnd(span: ReadableSpan): void {
    // SAFETY: the SDK hands onEnd the same object it handed onStart.
    this.open.delete(span as Span);
  }

  /**
   * End every open span as failed, newest first so children end before their
   * parents. `error.type` names the signal or the error's class. On a crash,
   * each local root records the exception once for its trace.
   */
  endAll(reason: { signal: string } | { error: unknown }): void {
    const crash = 'error' in reason ? reason.error : undefined;
    const errorType =
      'signal' in reason
        ? reason.signal
        : crash instanceof Error
          ? crash.name
          : 'Error';
    const message =
      'signal' in reason
        ? `Process stopped by ${reason.signal}`
        : 'Process exiting on an uncaught error';
    const spans = [...this.open].toReversed();
    this.open.clear();
    for (const span of spans) {
      const parent = span.parentSpanContext;
      if (crash instanceof Error && (!parent || parent.isRemote)) {
        span.recordException(crash);
      }
      span.setAttribute('error.type', errorType);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.end();
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.open.clear();
    return Promise.resolve();
  }
}
