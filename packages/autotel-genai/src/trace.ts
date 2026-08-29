/**
 * `traceGenAI` — wrap a GenAI operation with canonical `gen_ai.*` instrumentation.
 *
 * Names the span per the operation-specific upstream rules, sets the
 * request-side attributes up front, and gives you helpers to record the
 * response, token usage, and estimated cost when the call returns.
 *
 * @example Chat completion
 * ```typescript
 * import { traceGenAI, recordGenAiResponse, recordGenAiUsage } from 'autotel-genai/trace';
 *
 * export const chat = traceGenAI({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   operation: 'chat',
 *   temperature: 0.2,
 * })((ctx) => async (prompt: string) => {
 *   const res = await openai.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages: [{ role: 'user', content: prompt }],
 *   });
 *   recordGenAiResponse(ctx, {
 *     model: res.model,
 *     id: res.id,
 *     finishReasons: res.choices.map((c) => c.finish_reason),
 *   });
 *   recordGenAiUsage(ctx, 'gpt-4o', {
 *     inputTokens: res.usage?.prompt_tokens,
 *     outputTokens: res.usage?.completion_tokens,
 *   });
 *   return res.choices[0].message.content;
 * });
 * ```
 */

import {
  trace as otelTrace,
  type AttributeValue,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { withTracing, type TraceContext } from 'autotel';
import {
  genAiAgentAttributes,
  genAiRequestAttributes,
  genAiResponseAttributes,
  genAiToolAttributes,
  genAiUsageAttributes,
  genAiWorkflowAttributes,
  type GenAiAgentInput,
  type GenAiAttributeMap,
  type GenAiRequestInput,
  type GenAiResponseInput,
  type GenAiToolInput,
  type GenAiWorkflowInput,
} from './attributes.js';
import {
  estimateLLMCost,
  type EstimateCostOptions,
  type TokenUsage,
} from './cost.js';
import { recordGenAiMetrics } from './metrics.js';
import {
  GEN_AI,
  GEN_AI_OPERATION,
  genAiSpanName,
  type GenAiOperationName,
} from './semconv.js';
import type { UnknownRecord } from './values.js';
import { asNumber, asString, isFunction } from './values.js';

/** Configuration for {@link traceGenAI}. */
export interface TraceGenAIConfig extends GenAiRequestInput {
  /** Operation kind; defaults to `chat`. */
  operation?: GenAiOperationName | (string & {});
  /** Agent metadata used for agent span names and attributes. */
  agent?: GenAiAgentInput;
  /** Tool metadata used for tool span names and attributes. */
  tool?: GenAiToolInput;
  /** Workflow metadata used for workflow span names and attributes. */
  workflow?: GenAiWorkflowInput;
  /** Override the computed canonical span name. */
  spanName?: string;
  /** Extra attributes to set on the span (any namespace). */
  attributes?: GenAiAttributeMap;
  /**
   * Record the canonical GenAI metrics alongside the span. On by default, and
   * a no-op without a registered `MeterProvider`. Set `false` when something
   * upstream already emits `gen_ai.client.*` and you would double-count.
   */
  metrics?: boolean;
}

/**
 * What the metrics get to read: everything already on the span, overlaid with
 * what the handler wrote through `ctx`.
 *
 * Neither alone is enough. `getActiveTraceContext()` hands out a *new* context
 * object, so the documented ambient pattern
 * (`getActiveTraceContext()?.setAttribute('gen_ai.usage.input_tokens', n)`) —
 * and any helper that resolves the context itself — never passes through `ctx`.
 * The span in turn holds nothing when sampling declined to record, and metrics
 * are not sampled.
 */
function observed(seen: UnknownRecord): UnknownRecord {
  // SAFETY: a recording SDK span keeps the attributes set on it; the API type
  // does not declare them, and a non-recording span simply has none - see the
  // note on RecordedSpan below.
  const span = otelTrace.getActiveSpan() as RecordedSpan | undefined;
  return { ...span?.attributes, ...seen };
}

/**
 * A recording SDK span, which keeps the attributes set on it. The API `Span`
 * type does not declare them — they are absent on a non-recording span, hence
 * optional — and reading them is this module's business alone, so the shape is
 * named here rather than pulling in an SDK dependency.
 */
interface RecordedSpan extends Span {
  attributes?: Attributes;
}

/**
 * Record what is written through `ctx` into `seen`, and return the undo.
 *
 * The context is patched in place rather than wrapped: callers spread it
 * (`logger.info({ ...ctx }, 'llm call')`), and a `Object.create(ctx)` wrapper
 * spreads to nothing but the two overridden setters — no traceId, no spanId.
 */
function watchAttributes(ctx: TraceContext, seen: UnknownRecord): () => void {
  const { setAttribute, setAttributes } = ctx;
  ctx.setAttribute = (key: string, value: AttributeValue) => {
    seen[key] = value;
    setAttribute.call(ctx, key, value);
  };
  ctx.setAttributes = (attributes: Attributes) => {
    Object.assign(seen, attributes);
    setAttributes.call(ctx, attributes);
  };
  return () => {
    ctx.setAttribute = setAttribute;
    ctx.setAttributes = setAttributes;
  };
}

function defaultSpanIdentifier(config: TraceGenAIConfig): string | undefined {
  switch (config.operation) {
    case GEN_AI_OPERATION.RETRIEVAL: {
      return config.dataSourceId;
    }
    case GEN_AI_OPERATION.EXECUTE_TOOL: {
      return config.tool?.name;
    }
    case GEN_AI_OPERATION.CREATE_AGENT:
    case GEN_AI_OPERATION.INVOKE_AGENT:
    case GEN_AI_OPERATION.PLAN: {
      return config.agent?.name;
    }
    case GEN_AI_OPERATION.INVOKE_WORKFLOW: {
      return config.workflow?.workflowName;
    }
    case GEN_AI_OPERATION.CREATE_MEMORY:
    case GEN_AI_OPERATION.UPDATE_MEMORY:
    case GEN_AI_OPERATION.UPSERT_MEMORY:
    case GEN_AI_OPERATION.DELETE_MEMORY:
    case GEN_AI_OPERATION.SEARCH_MEMORY:
    case GEN_AI_OPERATION.CREATE_MEMORY_STORE:
    case GEN_AI_OPERATION.DELETE_MEMORY_STORE: {
      return undefined;
    }
    default: {
      return config.model;
    }
  }
}

/**
 * Build a traced GenAI factory. Pass a factory `(ctx) => (...args) => result`;
 * the returned function runs that handler inside a span carrying the canonical
 * request attributes.
 */
export function traceGenAI(config: TraceGenAIConfig) {
  const operation = config.operation ?? GEN_AI_OPERATION.CHAT;
  const spanName =
    config.spanName ??
    genAiSpanName(operation, defaultSpanIdentifier({ ...config, operation }));
  const requestAttributes = genAiRequestAttributes({ ...config, operation });
  // autotel `trace()` emits INTERNAL spans. Per spec breaking change #242,
  // internal agent spans (`invoke_agent`, `plan`) MUST NOT carry
  // `gen_ai.agent.id` — only `create_agent` (the created agent's stable id) and
  // remote CLIENT spans keep it. Key off the operation, not provider presence.
  const agentSpanIsInternal =
    operation === GEN_AI_OPERATION.INVOKE_AGENT ||
    operation === GEN_AI_OPERATION.PLAN;
  const agentAttributes = config.agent
    ? genAiAgentAttributes(config.agent, { internal: agentSpanIsInternal })
    : {};
  const toolAttributes = config.tool ? genAiToolAttributes(config.tool) : {};
  const workflowAttributes = config.workflow
    ? genAiWorkflowAttributes(config.workflow)
    : {};

  const emitMetrics = (watched: UnknownRecord, startedAt: number): void => {
    if (config.metrics === false) return;

    const seen = observed(watched);
    const attributes: Attributes = { [GEN_AI.OPERATION_NAME]: operation };
    if (config.provider) attributes[GEN_AI.PROVIDER_NAME] = config.provider;
    if (config.model) attributes[GEN_AI.REQUEST_MODEL] = config.model;
    const responseModel = asString(seen[GEN_AI.RESPONSE_MODEL]);
    if (responseModel !== undefined) {
      attributes[GEN_AI.RESPONSE_MODEL] = responseModel;
    }
    const errorType = asString(seen['error.type']);
    if (errorType !== undefined) attributes['error.type'] = errorType;

    recordGenAiMetrics({
      durationSeconds: (Date.now() - startedAt) / 1000,
      attributes,
      inputTokens: asNumber(seen[GEN_AI.USAGE_INPUT_TOKENS]),
      outputTokens: asNumber(seen[GEN_AI.USAGE_OUTPUT_TOKENS]),
      costUsd: asNumber(seen[GEN_AI.USAGE_COST_USD]),
      timeToFirstChunk: asNumber(seen[GEN_AI.RESPONSE_TIME_TO_FIRST_CHUNK]),
    });
  };

  return <TArgs extends unknown[], TReturn>(
    factory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    if (!isFunction(factory)) {
      throw new TypeError(
        'traceGenAI: expected a factory (ctx) => (...args) => result',
      );
    }
    return withTracing<TArgs, TReturn>({ name: spanName })(
      (ctx: TraceContext) => {
        // Watch what the handler writes so the metrics can carry the token
        // counts, cost and streaming timings the helpers put on the span. The
        // alternative is asking callers to report the same numbers twice.
        //
        // The context is patched in place rather than wrapped: `withTracing`
        // builds a fresh one per call, and callers spread it
        // (`logger.info({ ...ctx })`), which a derived object would reduce to
        // the two overridden setters — no traceId, no spanId.
        const seen: UnknownRecord = {};
        const unwatch =
          config.metrics === false ? () => {} : watchAttributes(ctx, seen);

        ctx.setAttributes({
          ...requestAttributes,
          ...agentAttributes,
          ...toolAttributes,
          ...workflowAttributes,
          ...(config.attributes ?? {}),
        });
        const handler = factory(ctx);
        if (!isFunction(handler)) {
          throw new TypeError(
            'traceGenAI: factory must return a function; expected (ctx) => (...args) => result',
          );
        }
        // A real function, not an arrow: `withTracing` forwards the receiver
        // with `fn.call(this, ...)` so a traced method still sees its object.
        return async function (this: unknown, ...args: TArgs) {
          const startedAt = Date.now();
          try {
            const result = await handler.call(this, ...args);
            emitMetrics(seen, startedAt);
            return result;
          } catch (error) {
            // The spec requires `error.type` on a failed GenAI operation, and
            // `gen_ai.client.operation.duration` splits on it. Same shape as
            // the rest of autotel: the error's name, or `Error` without one.
            const errorType =
              error instanceof Error ? error.name || 'Error' : 'Error';
            ctx.setAttribute('error.type', errorType);
            emitMetrics(seen, startedAt);
            throw error;
          } finally {
            unwatch();
          }
        };
      },
    ) as (...args: TArgs) => Promise<TReturn>;
  };
}

/** Alias for {@link traceGenAI}, kept for LLM-call ergonomics. */
export const traceLLM = traceGenAI;

/** Record canonical `gen_ai.response.*` attributes on the active span. */
export function recordGenAiResponse(
  ctx: Pick<TraceContext, 'setAttributes'>,
  input: GenAiResponseInput,
): void {
  const attrs = genAiResponseAttributes(input);
  if (Object.keys(attrs).length > 0) ctx.setAttributes(attrs);
}

/**
 * Record canonical `gen_ai.usage.*` token attributes and the estimated
 * `gen_ai.usage.cost.usd`. Returns the estimated cost (or `undefined` when the
 * model has no known pricing). Pass `recordCost: false` to skip cost estimation.
 */
export function recordGenAiUsage(
  ctx: Pick<TraceContext, 'setAttributes'>,
  model: string,
  usage: TokenUsage,
  options?: EstimateCostOptions & { recordCost?: boolean },
): number | undefined {
  const declined = options?.recordCost === false;
  const cost = declined ? undefined : estimateLLMCost(model, usage, options);
  const attrs = genAiUsageAttributes({
    ...usage,
    costUsd: cost,
    // Only when a price was wanted and none was found. A caller who declined
    // the cost is not missing one.
    unpricedModel: !declined && cost === undefined ? model : undefined,
  });
  if (Object.keys(attrs).length > 0) ctx.setAttributes(attrs);
  return cost;
}
