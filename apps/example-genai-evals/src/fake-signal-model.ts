import type {
  AiSdkEvaluationModel,
  AiSdkEvaluationResult,
  ConversationSignalInput,
} from 'autotel-genai';
import { CONVERSATION_SIGNAL_NAMES } from 'autotel-genai';

/**
 * Rebook flight: user corrects the agent, asks a follow-up, then gets resolved.
 * Probabilities mirror what a Jev pass would typically return for that shape.
 */
const REBOOK_ANSWERS: AiSdkEvaluationResult['answers'] = {
  user_frustrated: { type: 'boolean', probability: 0.78 },
  user_follow_up: { type: 'boolean', probability: 0.86 },
  user_disagrees: { type: 'boolean', probability: 0.71 },
  outcome_resolved: { type: 'boolean', probability: 0.92 },
  agent_corrected: { type: 'boolean', probability: 0.88 },
};

/** Smooth booking: resolved without friction. */
const SMOOTH_ANSWERS: AiSdkEvaluationResult['answers'] = {
  user_frustrated: { type: 'boolean', probability: 0.08 },
  user_follow_up: { type: 'boolean', probability: 0.11 },
  user_disagrees: { type: 'boolean', probability: 0.05 },
  outcome_resolved: { type: 'boolean', probability: 0.95 },
  agent_corrected: { type: 'boolean', probability: 0.04 },
};

/** Stuck and upset; never resolved. */
const STUCK_ANSWERS: AiSdkEvaluationResult['answers'] = {
  user_frustrated: { type: 'boolean', probability: 0.91 },
  user_follow_up: { type: 'boolean', probability: 0.84 },
  user_disagrees: { type: 'boolean', probability: 0.62 },
  outcome_resolved: { type: 'boolean', probability: 0.18 },
  agent_corrected: { type: 'boolean', probability: 0.22 },
};

export const SIGNAL_CONVERSATIONS: Array<{
  id: string;
  input: ConversationSignalInput;
  answers: AiSdkEvaluationResult['answers'];
}> = [
  {
    id: 'rebook-corrected',
    input: {
      turns: [
        { role: 'user', text: 'I need to rebook my flight to Tuesday.' },
        {
          role: 'assistant',
          text: 'Done — I have cancelled your Tuesday flight.',
        },
        {
          role: 'user',
          text: 'No, rebook it. Do not cancel. Can you move it to Tuesday evening?',
        },
        {
          role: 'assistant',
          text: 'Sorry about that. Rebooked for Tuesday 18:40. Confirmation is in your inbox.',
        },
      ],
    },
    answers: REBOOK_ANSWERS,
  },
  {
    id: 'smooth-booking',
    input: {
      turns: [
        { role: 'user', text: 'Book a hotel in Lisbon for Friday night.' },
        {
          role: 'assistant',
          text: 'Booked the Alfama Inn for Friday. Confirmation sent.',
        },
        { role: 'user', text: 'Perfect, thanks.' },
      ],
    },
    answers: SMOOTH_ANSWERS,
  },
  {
    id: 'stuck-frustrated',
    input: {
      turns: [
        { role: 'user', text: 'Where is my refund?' },
        {
          role: 'assistant',
          text: 'Refunds take 5–10 business days. Anything else?',
        },
        {
          role: 'user',
          text: 'It has been three weeks. This is ridiculous. Who do I talk to?',
        },
        {
          role: 'assistant',
          text: 'I recommend waiting a few more days.',
        },
      ],
    },
    answers: STUCK_ANSWERS,
  },
];

function turnsKey(turns: ConversationSignalInput['turns']): string {
  return JSON.stringify(turns);
}

/** In-process evaluation model: planted answers per fixture, no API key. */
export function fakeConversationSignalModel(
  fixtures: typeof SIGNAL_CONVERSATIONS = SIGNAL_CONVERSATIONS,
): AiSdkEvaluationModel {
  const byTurns = new Map(
    fixtures.map((fixture) => [turnsKey(fixture.input.turns), fixture]),
  );
  return {
    provider: 'typesafe-ai.evaluation',
    modelId: 'jev-1.13.0',
    async doEvaluate(options: {
      state: { turns?: ConversationSignalInput['turns'] };
    }): Promise<AiSdkEvaluationResult> {
      const turns = options.state?.turns ?? [];
      const fixture = byTurns.get(turnsKey(turns));
      const answers =
        fixture?.answers ??
        Object.fromEntries(
          CONVERSATION_SIGNAL_NAMES.map((name) => [
            name,
            { type: 'boolean' as const, probability: 0.5 },
          ]),
        );
      return {
        answers,
        usage: { inputTokens: 180, outputTokens: 36 },
        response: {
          id: `eval-${fixture?.id ?? 'unknown'}`,
          modelId: 'jev-1.13.0',
        },
      };
    },
  };
}
