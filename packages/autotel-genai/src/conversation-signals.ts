/**
 * Conversation-signal questions for evaluation models such as TypeSafe Jev:
 * one shared state, several independent boolean judgments in one pass.
 */

import {
  type AiSdkEvaluationAnswer,
  type AiSdkEvaluationModel,
  type AiSdkEvaluationResult,
  type WrapEvaluationModelOptions,
  wrapEvaluationModel,
} from './ai-sdk-evaluate.js';

/** One turn of the conversation under judgment. */
export interface ConversationSignalTurn {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

/** Input for {@link conversationSignalState} / {@link runConversationSignals}. */
export interface ConversationSignalInput {
  turns: ConversationSignalTurn[];
}

/** AI SDK boolean question shape. */
export interface ConversationSignalQuestion {
  type: 'boolean';
  instructions: string;
  criteria: { true: string; false: string };
}

export const CONVERSATION_SIGNAL_NAMES = [
  'user_frustrated',
  'user_follow_up',
  'user_disagrees',
  'outcome_resolved',
  'agent_corrected',
] as const;

export type ConversationSignalName = (typeof CONVERSATION_SIGNAL_NAMES)[number];

/**
 * Fixed pack of independent yes/no signals. Ask them together over the same
 * conversation state; answers cannot see one another.
 */
export const CONVERSATION_SIGNAL_QUESTIONS: Record<
  ConversationSignalName,
  ConversationSignalQuestion
> = {
  user_frustrated: {
    type: 'boolean',
    instructions:
      'Is the user showing frustration, anger, or strong dissatisfaction in this conversation?',
    criteria: {
      true: 'The user expresses irritation, uses harsh language, complains about the agent, or repeats the same complaint with escalating tone.',
      false:
        'The user is neutral, polite, or only mildly concerned; no clear frustration.',
    },
  },
  user_follow_up: {
    type: 'boolean',
    instructions:
      'Did the user ask a follow-up because a previous assistant answer was incomplete or unclear?',
    criteria: {
      true: 'The user asks again, requests clarification, or restates the need after an assistant reply that did not fully resolve it.',
      false:
        'There is no follow-up, or the next user turn is a new topic rather than chasing an unanswered prior ask.',
    },
  },
  user_disagrees: {
    type: 'boolean',
    instructions: 'Does the user disagree with something the assistant said?',
    criteria: {
      true: 'The user contradicts, rejects, or pushes back on an assistant claim or recommendation.',
      false:
        'The user accepts, ignores without challenge, or does not contest the assistant.',
    },
  },
  outcome_resolved: {
    type: 'boolean',
    instructions:
      "Was the user's main request resolved by the end of this conversation?",
    criteria: {
      true: 'The assistant completed the requested action or the user confirms the issue is fixed.',
      false:
        'The request is still open, blocked, deferred, or the conversation ends without a clear resolution.',
    },
  },
  agent_corrected: {
    type: 'boolean',
    instructions: 'Did the user have to correct a mistake the assistant made?',
    criteria: {
      true: 'The user points out an error, wrong fact, or wrong action and the assistant then adjusts.',
      false:
        'The assistant was not corrected; any clarification is not fixing an assistant mistake.',
    },
  },
};

/** Default P(true) cutoffs for `yes` / `no` labels. Tune on labeled traffic. */
export const DEFAULT_CONVERSATION_SIGNAL_THRESHOLDS: Record<
  ConversationSignalName,
  number
> = {
  user_frustrated: 0.7,
  user_follow_up: 0.7,
  user_disagrees: 0.7,
  outcome_resolved: 0.7,
  agent_corrected: 0.7,
};

/** Named JSON state for the evaluate call — not a single string blob. */
export function conversationSignalState(input: ConversationSignalInput): {
  turns: ConversationSignalTurn[];
} {
  return {
    turns: input.turns.map((turn) => ({ role: turn.role, text: turn.text })),
  };
}

export interface ConversationSignalResult {
  name: ConversationSignalName;
  scoreValue: number;
  scoreLabel: 'yes' | 'no';
}

/**
 * Map boolean answers to yes/no verdicts using per-key thresholds.
 * Non-boolean answers and unknown keys are skipped.
 */
export function conversationSignalResults(
  answers: Record<string, AiSdkEvaluationAnswer>,
  thresholds: Partial<
    Record<ConversationSignalName, number>
  > = DEFAULT_CONVERSATION_SIGNAL_THRESHOLDS,
): ConversationSignalResult[] {
  const results: ConversationSignalResult[] = [];
  for (const name of CONVERSATION_SIGNAL_NAMES) {
    const answer = answers[name];
    if (answer?.type !== 'boolean') continue;
    const threshold =
      thresholds[name] ?? DEFAULT_CONVERSATION_SIGNAL_THRESHOLDS[name];
    results.push({
      name,
      scoreValue: answer.probability,
      scoreLabel: answer.probability >= threshold ? 'yes' : 'no',
    });
  }
  return results;
}

export interface RunConversationSignalsOptions {
  /** Pricing lookup for `gen_ai.usage.cost.usd`; `recordCost: false` skips it. */
  cost?: WrapEvaluationModelOptions['cost'];
  /** Extra attributes for every evaluation span. */
  attributes?: WrapEvaluationModelOptions['attributes'];
  /** Record `gen_ai.client.*` metrics alongside the span (default on). */
  metrics?: WrapEvaluationModelOptions['metrics'];
  /** Override or subset of {@link CONVERSATION_SIGNAL_QUESTIONS}. */
  questions?: Partial<
    Record<ConversationSignalName, ConversationSignalQuestion>
  >;
  /** Per-signal P(true) cutoffs; defaults to {@link DEFAULT_CONVERSATION_SIGNAL_THRESHOLDS}. */
  thresholds?: Partial<Record<ConversationSignalName, number>>;
}

/**
 * Run the conversation-signal pack through an evaluation model (e.g. Jev).
 * Traces via {@link wrapEvaluationModel} and returns thresholded yes/no verdicts.
 */
export async function runConversationSignals(
  model: AiSdkEvaluationModel,
  input: ConversationSignalInput,
  options: RunConversationSignalsOptions = {},
): Promise<{
  results: ConversationSignalResult[];
  answers: AiSdkEvaluationResult['answers'];
}> {
  const thresholds = {
    ...DEFAULT_CONVERSATION_SIGNAL_THRESHOLDS,
    ...options.thresholds,
  };
  const questions = {
    ...CONVERSATION_SIGNAL_QUESTIONS,
    ...options.questions,
  };
  const traced = wrapEvaluationModel(model, {
    cost: options.cost,
    attributes: options.attributes,
    metrics: options.metrics,
    booleanThresholds: thresholds,
  });
  const result = await traced.doEvaluate({
    state: conversationSignalState(input),
    questions,
  } as never);
  return {
    answers: result.answers,
    results: conversationSignalResults(result.answers, thresholds),
  };
}
