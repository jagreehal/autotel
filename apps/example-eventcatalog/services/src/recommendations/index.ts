// RecommendationsService — generates a personalized post-purchase
// recommendation via an LLM. The autotel gen-AI instrumentation surfaces the
// model, prompt tokens, and completion tokens to the catalog as evidence.

import { traceConsumer } from 'autotel/messaging';
import type { OrderPlacedMessage } from '../shared/types';
import { recommendationGeneratedEvent } from '../shared/events';

/** The fields this service tracks on a recommendation event. */
type RecommendationGeneratedFields = {
  orderId: string;
  recommendations: unknown;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  personalization_seed: string;
  _autotel: { channel: string; producer: string };
  /** Added only while the live runner is demonstrating schema drift. */
  _drift_demo_field?: string;
};

const openai = {
  chat: {
    completions: {
      create: async (_args: { model: string; messages: unknown }) => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  sku: 'sku-rec-1',
                  score: 0.91,
                  reason: 'frequently bought together',
                },
                {
                  sku: 'sku-rec-2',
                  score: 0.78,
                  reason: 'matches style profile',
                },
                { sku: 'sku-rec-3', score: 0.62, reason: 'completes the set' },
              ]),
            },
          },
        ],
        usage: { prompt_tokens: 412, completion_tokens: 142 },
      }),
    },
  },
};

function buildPrompt(msg: OrderPlacedMessage) {
  return [
    {
      role: 'system',
      content: 'Suggest 3 SKUs the customer is likely to buy next.',
    },
    {
      role: 'user',
      content: JSON.stringify({ skus: msg.items.map((i) => i.sku) }),
    },
  ];
}

export const generateRecommendation = traceConsumer({
  system: 'kafka',
  destination: 'orders.events',
})(() => async (msg: OrderPlacedMessage) => {
  const result = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: buildPrompt(msg),
  });

  const recommendations = JSON.parse(result.choices[0].message.content);

  const extra = globalThis.__autotel_demo_extra_recommendation_field__ === true;

  const event: RecommendationGeneratedFields = {
    orderId: msg.id,
    recommendations,
    model: 'gpt-4o-mini',
    usage: {
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
    },
    // Real-world example of the drift autotel-eventcatalog catches: the
    // RecommendationGenerated schema does not declare this field. Running
    // `pnpm catalog:drift` will surface it.
    personalization_seed: `seed-${msg.id.slice(-6)}`,
    _autotel: { channel: 'orders.events', producer: 'RecommendationsService' },
  };

  // Only present when the live runner has decided to introduce mid-run drift —
  // lets the dashboard show drift appearing in real time.
  if (extra) {
    event._drift_demo_field = 'introduced-mid-run';
  }

  recommendationGeneratedEvent.track(event);
});
