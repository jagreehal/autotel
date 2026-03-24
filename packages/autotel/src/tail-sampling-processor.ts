/**
 * Tail Sampling Span Processor
 *
 * Filters spans based on the `autotel.sampling.tail.keep` attribute set during execution.
 * This enables adaptive sampling where we decide whether to keep a span AFTER
 * the operation completes, based on criteria like errors, duration, etc.
 *
 * How it works:
 * 1. Decorator creates span optimistically (head sampling returns true)
 * 2. Operation executes and completes
 * 3. Decorator calls shouldKeepTrace() and sets autotel.sampling.tail.keep attribute
 * 4. This processor checks the attribute and drops spans marked as false
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';
import {
  AUTOTEL_SAMPLING_TAIL_KEEP,
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
} from './sampling';

export class TailSamplingSpanProcessor implements SpanProcessor {
  private wrappedProcessor: SpanProcessor;

  constructor(wrappedProcessor: SpanProcessor) {
    this.wrappedProcessor = wrappedProcessor;
  }

  onStart(span: Span, parentContext: Context): void {
    this.wrappedProcessor.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const tailEvaluated = span.attributes[AUTOTEL_SAMPLING_TAIL_EVALUATED];
    const shouldKeep = span.attributes[AUTOTEL_SAMPLING_TAIL_KEEP];

    if (tailEvaluated === true && shouldKeep === false) {
      return;
    }

    this.wrappedProcessor.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.wrappedProcessor.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.wrappedProcessor.shutdown();
  }
}
