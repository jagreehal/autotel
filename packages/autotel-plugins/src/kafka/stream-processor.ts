/**
 * Stream processor for Kafka pipeline patterns.
 *
 * Provides a structured way to process messages through stages,
 * with proper span nesting and lineage tracking.
 *
 * Propagation story:
 * - Stage spans are children of the processor span
 * - Produce spans are children of the stage span that calls producer.send
 * - Output messages carry context from produce span (injected headers)
 * - For lineage: SpanLink from produce span to input message's extracted context
 *
 * @example
 * ```typescript
 * import { createStreamProcessor } from 'autotel-plugins/kafka';
 *
 * const processor = createStreamProcessor({
 *   name: 'order-enrichment',
 *   stages: ['validate', 'enrich', 'publish'],
 * });
 *
 * await consumer.run({
 *   eachMessage: async ({ message }) => {
 *     await processor.run(message, async (ctx) => {
 *       const validated = await ctx.stage('validate', () => validate(message));
 *       const enriched = await ctx.stage('enrich', () => enrich(validated));
 *       await ctx.stage('publish', () =>
 *         ctx.produce('enriched-orders', enriched, { linkToInput: true })
 *       );
 *     });
 *   },
 * });
 * ```
 */

import {
  otelTrace as trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type SpanLink,
  type SpanContext,
} from 'autotel';
import {
  SEMATTRS_MESSAGING_SYSTEM,
  SEMATTRS_MESSAGING_DESTINATION_NAME,
  SEMATTRS_MESSAGING_OPERATION,
} from '../common/constants';
import { normalizeHeaders, extractTraceContext } from './headers';
import { injectTraceHeaders } from './correlation';
import type { RawKafkaHeaders } from './types';

const DEFAULT_TRACER_NAME = 'autotel-plugins/kafka';

/**
 * Input message type for stream processing.
 */
export interface StreamMessage {
  headers?: RawKafkaHeaders;
  key?: Buffer | null;
  value: Buffer | null;
  offset?: string;
}

/**
 * Configuration for stream processor.
 */
export interface StreamProcessorConfig {
  /**
   * Name for the processor (e.g., "order-enrichment")
   */
  name: string;

  /**
   * Expected stage names (for documentation/validation).
   * Stages can be run in any order.
   */
  stages?: string[];
}

/**
 * Options for producing output messages.
 */
export interface ProduceOptions {
  /**
   * Create a SpanLink to the input message's extracted context.
   * Useful for lineage tracking.
   * @default false
   */
  linkToInput?: boolean;

  /**
   * Additional headers to include (merged with trace headers).
   */
  headers?: Record<string, string>;
}

/**
 * Context passed to the processor callback.
 */
export interface ProcessorContext {
  /**
   * The processor-level span.
   */
  span: Span;

  /**
   * Execute a named stage with automatic span creation.
   *
   * @param stageName - Name of the stage (e.g., "validate", "enrich")
   * @param fn - Stage function to execute
   * @returns Result of the stage function
   */
  stage<T>(stageName: string, fn: () => T | Promise<T>): Promise<T>;

  /**
   * Produce a message with proper span creation and header injection.
   *
   * The returned headers should be used when actually sending the message.
   *
   * @param topic - Destination topic
   * @param payload - Message payload
   * @param options - Produce options
   * @returns Headers to use when sending (includes trace context)
   */
  produce(
    topic: string,
    payload: unknown,
    options?: ProduceOptions,
  ): Promise<Record<string, string>>;

  /**
   * Get the extracted context from the input message.
   * Useful for creating manual links or context propagation.
   */
  inputContext: SpanContext | undefined;
}

/**
 * Processor callback type.
 */
export type ProcessorCallback<T> = (ctx: ProcessorContext) => Promise<T>;

/**
 * Stream processor instance.
 */
export interface StreamProcessor {
  /**
   * Run the processor on an input message.
   *
   * @param message - Input Kafka message
   * @param callback - Processor callback with stage/produce helpers
   * @returns Result of the processor callback
   */
  run<T>(message: StreamMessage, callback: ProcessorCallback<T>): Promise<T>;
}

/**
 * Create a stream processor for pipeline-style message processing.
 *
 * @param config - Processor configuration
 * @returns Stream processor instance
 *
 * @example
 * ```typescript
 * const processor = createStreamProcessor({
 *   name: 'order-enrichment',
 *   stages: ['validate', 'enrich', 'publish'],
 * });
 *
 * await processor.run(message, async (ctx) => {
 *   const validated = await ctx.stage('validate', async () => {
 *     return validateOrder(message.value);
 *   });
 *
 *   const enriched = await ctx.stage('enrich', async () => {
 *     return enrichWithCustomerData(validated);
 *   });
 *
 *   await ctx.stage('publish', async () => {
 *     const headers = await ctx.produce('enriched-orders', enriched, {
 *       linkToInput: true,
 *     });
 *     await producer.send({
 *       topic: 'enriched-orders',
 *       messages: [{ value: JSON.stringify(enriched), headers }],
 *     });
 *   });
 * });
 * ```
 */
export function createStreamProcessor(
  config: StreamProcessorConfig,
): StreamProcessor {
  const { name } = config;
  const tracer = trace.getTracer(DEFAULT_TRACER_NAME);

  return {
    async run<T>(
      message: StreamMessage,
      callback: ProcessorCallback<T>,
    ): Promise<T> {
      // Extract context from input message
      const normalizedHeaders = normalizeHeaders(message.headers);
      const extractedCtx = extractTraceContext(normalizedHeaders);
      const inputSpanContext = trace.getSpanContext(extractedCtx);

      // Create processor span (inherits from extracted context if valid)
      const processorSpan = tracer.startSpan(
        name,
        {
          kind: SpanKind.CONSUMER,
        },
        inputSpanContext && trace.isSpanContextValid(inputSpanContext)
          ? extractedCtx
          : undefined,
      );

      processorSpan.setAttribute(SEMATTRS_MESSAGING_SYSTEM, 'kafka');
      processorSpan.setAttribute(SEMATTRS_MESSAGING_OPERATION, 'process');

      const processorContext = trace.setSpan(context.active(), processorSpan);

      // Create context object with helpers
      const ctx: ProcessorContext = {
        span: processorSpan,
        inputContext: inputSpanContext,

        async stage<S>(
          stageName: string,
          fn: () => S | Promise<S>,
        ): Promise<S> {
          return context.with(processorContext, async () => {
            const stageSpan = tracer.startSpan(`${name}.${stageName}`, {
              kind: SpanKind.INTERNAL,
            });

            stageSpan.setAttribute('stream.stage', stageName);

            const stageContext = trace.setSpan(context.active(), stageSpan);

            try {
              const result = await context.with(stageContext, async () => {
                return await fn();
              });

              stageSpan.setStatus({ code: SpanStatusCode.OK });
              stageSpan.end();

              return result;
            } catch (error) {
              stageSpan.setStatus({ code: SpanStatusCode.ERROR });
              if (error instanceof Error) {
                stageSpan.recordException(error);
              } else {
                stageSpan.recordException(new Error(String(error)));
              }
              stageSpan.end();

              throw error;
            }
          });
        },

        async produce(
          topic: string,
          _payload: unknown,
          options?: ProduceOptions,
        ): Promise<Record<string, string>> {
          const { linkToInput = false, headers: extraHeaders = {} } =
            options ?? {};

          // Build links
          const links: SpanLink[] = [];
          if (
            linkToInput &&
            inputSpanContext &&
            trace.isSpanContextValid(inputSpanContext)
          ) {
            links.push({ context: inputSpanContext });
          }

          // Create produce span as child of current context (the stage span)
          const produceSpan = tracer.startSpan(`${name}.produce`, {
            kind: SpanKind.PRODUCER,
            links,
          });

          produceSpan.setAttribute(SEMATTRS_MESSAGING_SYSTEM, 'kafka');
          produceSpan.setAttribute(SEMATTRS_MESSAGING_DESTINATION_NAME, topic);
          produceSpan.setAttribute(SEMATTRS_MESSAGING_OPERATION, 'publish');

          // Inject trace context from within the produce span
          const produceContext = trace.setSpan(context.active(), produceSpan);

          return context.with(produceContext, () => {
            const headers = injectTraceHeaders(extraHeaders, {
              includeCorrelationIdHeader: true,
            });

            produceSpan.setStatus({ code: SpanStatusCode.OK });
            produceSpan.end();

            return headers;
          });
        },
      };

      try {
        const result = await context.with(processorContext, async () => {
          return await callback(ctx);
        });

        processorSpan.setStatus({ code: SpanStatusCode.OK });
        processorSpan.end();

        return result;
      } catch (error) {
        processorSpan.setStatus({ code: SpanStatusCode.ERROR });
        if (error instanceof Error) {
          processorSpan.recordException(error);
        } else {
          processorSpan.recordException(new Error(String(error)));
        }
        processorSpan.end();

        throw error;
      }
    },
  };
}
