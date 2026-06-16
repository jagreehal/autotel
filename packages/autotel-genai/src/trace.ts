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

import { trace, type TraceContext } from 'autotel';
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
import {
  GEN_AI_OPERATION,
  genAiSpanName,
  type GenAiOperationName,
} from './semconv.js';

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

  return <TArgs extends unknown[], TReturn>(
    factory: (ctx: TraceContext) => (...args: TArgs) => Promise<TReturn>,
  ): ((...args: TArgs) => Promise<TReturn>) => {
    return trace<TArgs, TReturn>(spanName, (ctx: TraceContext) => {
      ctx.setAttributes({
        ...requestAttributes,
        ...agentAttributes,
        ...toolAttributes,
        ...workflowAttributes,
        ...(config.attributes ?? {}),
      });
      return factory(ctx);
    });
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
  const cost =
    options?.recordCost === false
      ? undefined
      : estimateLLMCost(model, usage, options);
  const attrs = genAiUsageAttributes({ ...usage, costUsd: cost });
  if (Object.keys(attrs).length > 0) ctx.setAttributes(attrs);
  return cost;
}
