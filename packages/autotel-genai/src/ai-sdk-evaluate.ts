/**
 * Vercel AI SDK evaluation models (`experimental_evaluate`, e.g. TypeSafe Jev).
 *
 * The AI SDK's tracing channel publishes generateText, streamText, step,
 * languageModelCall, executeTool, embed and rerank — not evaluate — so the
 * observer never sees an evaluation call. {@link wrapEvaluationModel} closes
 * that gap at the model boundary: every `doEvaluate` becomes an
 * `evaluate {model}` span carrying `gen_ai.*` request, response, usage and cost
 * attributes, plus one `gen_ai.evaluation.result` event per answer.
 */

import { type EstimateCostOptions } from './cost.js';
import { recordEvaluationResult } from './events.js';
import { normalizeAiSdkProvider } from './ai-sdk-bridge.js';
import type { GenAiAttributeMap } from './attributes.js';
import { recordGenAiResponse, recordGenAiUsage, traceGenAI } from './trace.js';

/** `gen_ai.operation.name` for an evaluation call; not yet in the semconv registry. */
export const GEN_AI_OPERATION_EVALUATE = 'evaluate';

/** One answer from `EvaluationModelV4Result.answers`, in the shape the AI SDK returns. */
export type AiSdkEvaluationAnswer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; probabilities?: Record<string, number> }
  | { type: 'boolean'; probability: number };

/** The parts of `EvaluationModelV4Result` this module reads. */
export interface AiSdkEvaluationResult {
  answers: Record<string, AiSdkEvaluationAnswer>;
  usage?: { inputTokens?: number; outputTokens?: number };
  response?: { id?: string; modelId?: string };
}

/** The parts of `EvaluationModelV4` this module needs; structural so `ai` is not a dependency. */
export interface AiSdkEvaluationModel {
  readonly provider: string;
  readonly modelId: string;
  doEvaluate(options: never): PromiseLike<AiSdkEvaluationResult>;
}

export interface WrapEvaluationModelOptions {
  /** Pricing lookup for `gen_ai.usage.cost.usd`; `recordCost: false` skips it. */
  cost?: EstimateCostOptions & { recordCost?: boolean };
  /** Extra attributes for every evaluation span. */
  attributes?: GenAiAttributeMap;
  /** Record `gen_ai.client.*` metrics alongside the span (default on). */
  metrics?: boolean;
}

/** Score value and label for the `gen_ai.evaluation.result` event of one answer. */
export function evaluationScore(answer: AiSdkEvaluationAnswer): {
  scoreValue?: number;
  scoreLabel?: string;
} {
  switch (answer.type) {
    case 'choice': {
      return {
        scoreLabel: answer.choice,
        scoreValue: answer.probabilities?.[answer.choice],
      };
    }
    case 'score': {
      return { scoreValue: answer.score };
    }
    case 'boolean': {
      return { scoreValue: answer.probability };
    }
  }
}

/**
 * Wrap an AI SDK evaluation model so each call is traced. Returns a model with
 * the same contract, so it drops into `experimental_evaluate({ model })`.
 *
 * @example
 * ```ts
 * const model = wrapEvaluationModel(typeSafeAi.evaluationModel('jev-latest'));
 * const { answers } = await evaluate({ model, state, questions });
 * ```
 */
export function wrapEvaluationModel<M extends AiSdkEvaluationModel>(
  model: M,
  options: WrapEvaluationModelOptions = {},
): M {
  type Call = Parameters<M['doEvaluate']>[0];
  type Result = Awaited<ReturnType<M['doEvaluate']>>;
  const traced = traceGenAI({
    operation: GEN_AI_OPERATION_EVALUATE,
    provider: normalizeAiSdkProvider(model.provider),
    model: model.modelId,
    attributes: options.attributes,
    metrics: options.metrics,
  })((ctx) => async (call: Call): Promise<Result> => {
    const result = (await model.doEvaluate(call)) as Result;
    const seen: AiSdkEvaluationResult = result;
    recordGenAiResponse(ctx, {
      model: seen.response?.modelId,
      id: seen.response?.id,
    });
    if (seen.usage) {
      recordGenAiUsage(ctx, model.modelId, seen.usage, options.cost);
    }
    for (const [name, answer] of Object.entries(seen.answers)) {
      recordEvaluationResult(ctx, {
        name,
        ...evaluationScore(answer),
        responseId: seen.response?.id,
      });
    }
    return result;
  });
  // Copy rather than spread: provider models may keep the contract fields on
  // the prototype, and the closure above holds the original for the call.
  return Object.create(model, {
    doEvaluate: { value: traced, enumerable: true },
  }) as M;
}
