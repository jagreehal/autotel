import type { Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

/**
 * `spanEnrichers` in front of the processors that export, as one processor.
 *
 * Spans reach the enrichers first, as they would in a flat list. The
 * difference is flush and shutdown: the SDK runs those on every processor at
 * once, so an enricher that ends a span of its own while it drains (an async
 * judgment, say) would hand it to an exporter that had already closed. Here the
 * enrichers drain first and the exporters flush after them.
 */
export class EnrichedSpanProcessor implements SpanProcessor {
  /** Every processor in call order: the enrichers, then the rest. */
  readonly processors: readonly SpanProcessor[];

  constructor(
    private readonly enrichers: readonly SpanProcessor[],
    private readonly downstream: readonly SpanProcessor[],
  ) {
    this.processors = [...enrichers, ...downstream];
  }

  onStart(span: Span, parentContext: Context): void {
    for (const processor of this.processors)
      processor.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    for (const processor of this.processors) processor.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.drainThenRun((p) => p.forceFlush());
  }

  shutdown(): Promise<void> {
    return this.drainThenRun((p) => p.shutdown());
  }

  // A failing enricher must not leave the exporters unflushed or open: they
  // run regardless, and the enricher's error is raised once they are done.
  private async drainThenRun(
    run: (processor: SpanProcessor) => Promise<void>,
  ): Promise<void> {
    const drained = await Promise.allSettled(
      this.enrichers.map(async (p) => run(p)),
    );
    await Promise.all(this.downstream.map(run));
    const failed = drained.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
}
