/**
 * On-demand Bedrock list prices, USD per 1M tokens, keyed the way
 * `autotel-genai/cost` resolves them: an exact or prefix match on the
 * foundation model id, tried again after each vendor/region prefix is
 * peeled off. So `eu.amazon.nova-pro-v1:0` resolves via `amazon.nova-pro`.
 *
 * Bedrock bills Anthropic models at Anthropic's rates and `autotel-genai`
 * prices those by family, so this table covers the models that only exist
 * behind Bedrock.
 *
 * Public prices at the time of writing (eu-west-1 / us-east-1 on-demand), a
 * convenience default rather than a billing source of truth. Check
 * https://aws.amazon.com/bedrock/pricing/ and override what you use.
 */
export interface BedrockModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
  cacheWritePer1M?: number;
}

export const BEDROCK_PRICING: Record<string, BedrockModelPricing> = {
  // Amazon Nova
  'amazon.nova-micro': { inputPer1M: 0.035, outputPer1M: 0.14 },
  'amazon.nova-lite': { inputPer1M: 0.06, outputPer1M: 0.24 },
  'amazon.nova-pro': { inputPer1M: 0.8, outputPer1M: 3.2 },
  'amazon.nova-premier': { inputPer1M: 2.5, outputPer1M: 12.5 },
  // Meta Llama
  'meta.llama3-1-8b-instruct': { inputPer1M: 0.22, outputPer1M: 0.22 },
  'meta.llama3-1-70b-instruct': { inputPer1M: 0.72, outputPer1M: 0.72 },
  'meta.llama3-3-70b-instruct': { inputPer1M: 0.72, outputPer1M: 0.72 },
  'meta.llama4-scout-17b-instruct': { inputPer1M: 0.17, outputPer1M: 0.66 },
  'meta.llama4-maverick-17b-instruct': { inputPer1M: 0.24, outputPer1M: 0.97 },
  // Mistral
  'mistral.mistral-large': { inputPer1M: 2, outputPer1M: 6 },
  'mistral.pixtral-large': { inputPer1M: 2, outputPer1M: 6 },
  // DeepSeek
  'deepseek.r1': { inputPer1M: 1.35, outputPer1M: 5.4 },
  // Z.ai
  'zai.glm-4.7-flash': { inputPer1M: 0.6, outputPer1M: 2.2 },
};
