// RecommendationsService — generates a personalized post-purchase
// recommendation via an LLM. The autotel gen-AI instrumentation surfaces the
// model, prompt tokens, and completion tokens to the catalog as evidence.

import { traceConsumer } from 'autotel/messaging';
import type { OrderPlacedMessage } from '../shared/types';
import { recommendationGeneratedEvent } from '../shared/events';

const openai = {
  chat: {
    completions: {
      create: async (_args: { model: string; messages: unknown }) => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { sku: 'sku-rec-1', score: 0.91, reason: 'frequently bought together' },
                { sku: 'sku-rec-2', score: 0.78, reason: 'matches style profile' },
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
    { role: 'system', content: 'Suggest 3 SKUs the customer is likely to buy next.' },
    { role: 'user', content: JSON.stringify({ skus: msg.items.map((i) => i.sku) }) },
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

  const extra =
    (globalThis as { __autotel_demo_extra_recommendation_field__?: boolean })
      .__autotel_demo_extra_recommendation_field__ === true;

  recommendationGeneratedEvent.track({
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
    // Only present when the live runner has decided to introduce mid-run
    // drift — lets the dashboard show drift appearing in real time.
    ...(extra ? { _drift_demo_field: 'introduced-mid-run' } : {}),
    _autotel: { channel: 'orders.events', producer: 'RecommendationsService' },
  });
});
