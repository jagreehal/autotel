/**
 * Composition helpers for building autotel pipelines from small, testable parts.
 *
 * The motivation is the same as for any pipeline library: you can author
 * subscribers, post-processors and span processors as standalone units and
 * stitch them together at config-construction time without inventing ad-hoc
 * wrappers in every package.
 *
 * None of these helpers change runtime behaviour by themselves — they only
 * combine functions / processors that already work in isolation.
 */
import type { Span } from '@opentelemetry/api';
import type { ReadableSpan as SdkReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type {
  EdgeConfig,
  EdgeEvent,
  EdgeSubscriber,
  PostProcessorFn,
  ReadableSpan as EdgeReadableSpan,
  ResolveConfigFn,
} from './types';

type Awaitable<T> = T | Promise<T>;

/**
 * Identity helper for authoring an autotel configuration once with full
 * type-checking. Mirrors `defineConfig` patterns in tools like Vite / Vitest.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'autotel-edge'
 *
 * export const otelConfig = defineConfig({
 *   service: { name: 'checkout' },
 *   exporter: { url: process.env.OTLP_URL! },
 * })
 * ```
 */
export function defineConfig<T extends EdgeConfig | ResolveConfigFn>(config: T): T {
  return config;
}

/**
 * Run a list of subscribers in registration order. Errors thrown by an
 * individual subscriber are caught and logged so a buggy subscriber never
 * blocks the others — important because `subscribers` is the primary
 * extensibility point for in-process side effects.
 */
export function composeSubscribers(
  subscribers: Array<EdgeSubscriber>,
  options: { name?: string } = {},
): EdgeSubscriber {
  const label = options.name ?? 'compose-subscribers';
  return async (event: EdgeEvent) => {
    for (const subscriber of subscribers) {
      try {
        await subscriber(event);
      } catch (err) {
        console.error(`[autotel-edge/${label}] subscriber failed:`, err);
      }
    }
  };
}

/**
 * Chain post-processors so each one sees the output of the previous one.
 * This matches the standard OTel post-processor contract: take spans, return
 * spans (possibly filtered, redacted, or annotated).
 */
export function composePostProcessors(
  processors: Array<PostProcessorFn>,
): PostProcessorFn {
  return (spans: EdgeReadableSpan[]) => {
    let current = spans;
    for (const processor of processors) {
      try {
        current = processor(current);
      } catch (err) {
        console.error('[autotel-edge/compose-post-processors] failed:', err);
      }
    }
    return current;
  };
}

/**
 * Fan out span lifecycle events to multiple span processors. Any single
 * processor's failure is isolated so it cannot break the others.
 *
 * Useful when you want to attach, say, a sampling processor + a custom
 * attribute redactor + the default batch processor without having to author a
 * single processor that knows about all three.
 */
export function composeSpanProcessors(processors: SpanProcessor[]): SpanProcessor {
  const safe = (label: string, fn: () => Awaitable<void>) =>
    Promise.resolve()
      .then(fn)
      .catch((err) => {
        console.error(`[autotel-edge/compose-span-processors:${label}]`, err);
      });

  return {
    onStart(span: Span, parentContext) {
      for (const processor of processors) {
        try {
          processor.onStart(span as unknown as SdkReadableSpan & Span, parentContext);
        } catch (err) {
          console.error('[autotel-edge/compose-span-processors:onStart]', err);
        }
      }
    },
    onEnd(span: SdkReadableSpan) {
      for (const processor of processors) {
        try {
          processor.onEnd(span);
        } catch (err) {
          console.error('[autotel-edge/compose-span-processors:onEnd]', err);
        }
      }
    },
    async forceFlush() {
      await Promise.allSettled(
        processors.map((p) => safe('forceFlush', () => p.forceFlush())),
      );
    },
    async shutdown() {
      await Promise.allSettled(
        processors.map((p) => safe('shutdown', () => p.shutdown())),
      );
    },
  } as SpanProcessor;
}
