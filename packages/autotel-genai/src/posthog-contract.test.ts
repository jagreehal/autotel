/**
 * The claim this file pins: a span autotel-genai builds lands in PostHog's LLM
 * analytics with no mapping layer in between.
 *
 * PostHog ingests plain OTLP now — `@posthog/ai/otel`'s `PostHogSpanProcessor`
 * forwards any span it recognises as AI-related to `/i/v0/ai/otel`, and the
 * `$ai_*` event is assembled server-side from canonical attributes. So the
 * integration is not code, it is an agreement about attribute names, and an
 * agreement nobody tests is a claim that quietly stops being true.
 *
 * The filter and the fields below are transcribed from `@posthog/ai`
 * (`src/otel/spans.ts`, `src/captureAiGeneration.ts`). Nothing here imports
 * PostHog: the point is that autotel owes it nothing but the canonical names.
 */

import { describe, expect, it } from 'vitest';
import {
  genAiRequestAttributes,
  genAiResponseAttributes,
  genAiUsageAttributes,
} from './attributes.js';
import { setGenAiContent } from './events.js';
import { genAiSpanName } from './semconv.js';

/** `AI_SPAN_PREFIXES` in `@posthog/ai/src/otel/spans.ts`. */
const AI_SPAN_PREFIXES = ['gen_ai.', 'llm.', 'ai.', 'traceloop.'];

/** `isAISpan()` in `@posthog/ai/src/otel/spans.ts`. */
function isAISpan(span: {
  name: string;
  attributes: Record<string, unknown>;
}): boolean {
  if (AI_SPAN_PREFIXES.some((prefix) => span.name.startsWith(prefix)))
    return true;
  return Object.keys(span.attributes).some((key) =>
    AI_SPAN_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

function chatSpan(): { name: string; attributes: Record<string, unknown> } {
  const attributes: Record<string, unknown> = {
    ...genAiRequestAttributes({
      operation: 'chat',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      temperature: 0.2,
      maxTokens: 1024,
      serverAddress: 'api.anthropic.com',
    }),
    ...genAiResponseAttributes({
      model: 'claude-sonnet-4-20250514',
      id: 'msg_01abc',
      finishReasons: ['end_turn'],
    }),
    ...genAiUsageAttributes({
      inputTokens: 412,
      outputTokens: 87,
      cacheReadInputTokens: 300,
      costUsd: 0.0021,
      tokenSource: 'observed',
    }),
  };
  setGenAiContent(
    {
      setAttributes: (attrs) => Object.assign(attributes, attrs),
      track: () => {},
    },
    {
      inputMessages: [
        { role: 'user', parts: [{ type: 'text', content: 'hello' }] },
      ],
      outputMessages: [
        { role: 'assistant', parts: [{ type: 'text', content: 'hi' }] },
      ],
    },
  );
  return { name: genAiSpanName('chat', 'claude-sonnet-4'), attributes };
}

describe('PostHog OTLP ingestion contract', () => {
  it('is recognised as an AI span by name alone', () => {
    // `chat claude-sonnet-4` does not start with an AI prefix, so the
    // attributes have to carry it — which is why the attribute check matters.
    expect(isAISpan({ name: chatSpan().name, attributes: {} })).toBe(false);
  });

  it('is recognised as an AI span by its attributes', () => {
    expect(isAISpan(chatSpan())).toBe(true);
  });

  it.each([
    // PostHog property        canonical attribute autotel emits
    ['$ai_provider', 'gen_ai.provider.name'],
    ['$ai_model', 'gen_ai.request.model'],
    ['$ai_model (response)', 'gen_ai.response.model'],
    ['$ai_completion_id', 'gen_ai.response.id'],
    ['$ai_stop_reason', 'gen_ai.response.finish_reasons'],
    ['$ai_input_tokens', 'gen_ai.usage.input_tokens'],
    ['$ai_output_tokens', 'gen_ai.usage.output_tokens'],
    ['$ai_cache_read_input_tokens', 'gen_ai.usage.cache_read.input_tokens'],
    ['$ai_total_cost_usd', 'gen_ai.usage.cost.usd'],
    ['$ai_input', 'gen_ai.input.messages'],
    ['$ai_output_choices', 'gen_ai.output.messages'],
    ['$ai_base_url', 'server.address'],
    ['$ai_model_parameters', 'gen_ai.request.temperature'],
  ])('carries what PostHog reads for %s', (_property, attribute) => {
    expect(chatSpan().attributes[attribute]).toBeDefined();
  });

  it('leaves PostHog nothing to redact on export', () => {
    // PostHog re-redacts base64 on the way out (`src/otel/redact.ts`). Ours
    // ran first, so its placeholder is what travels — not a megabyte of image.
    const attributes: Record<string, unknown> = {};
    setGenAiContent(
      {
        setAttributes: (attrs) => Object.assign(attributes, attrs),
        track: () => {},
      },
      {
        inputMessages: [
          {
            role: 'user',
            parts: [{ type: 'input_image', data: new Uint8Array(4_000_000) }],
          },
        ],
      },
    );
    const serialised = attributes['gen_ai.input.messages'] as string;
    expect(serialised).toContain('[base64 image redacted]');
    expect(serialised.length).toBeLessThan(1000);
  });
});
