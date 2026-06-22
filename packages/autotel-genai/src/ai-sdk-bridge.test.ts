import { describe, expect, it, vi } from 'vitest';
import {
  AUTOTEL_ENRICHED_ATTR,
  autotelEnrich,
  estimateAiSdkCost,
  extractAiSdkModel,
  extractAiSdkUsage,
  mapAiSdkAttributes,
  normalizeAiSdkProvider,
  recordAiSdkCost,
} from './ai-sdk-bridge.js';

describe('normalizeAiSdkProvider', () => {
  it('maps prefixed AI SDK provider ids to canonical names', () => {
    expect(normalizeAiSdkProvider('openai.chat')).toBe('openai');
    expect(normalizeAiSdkProvider('amazon-bedrock')).toBe('aws.bedrock');
    expect(normalizeAiSdkProvider('google.generative-ai')).toBe('gcp.gemini');
  });

  it('passes through unknown providers unchanged', () => {
    expect(normalizeAiSdkProvider('acme-llm')).toBe('acme-llm');
  });
});

describe('extractAiSdkUsage', () => {
  it('reads canonical gen_ai.usage.* first', () => {
    expect(
      extractAiSdkUsage({
        'gen_ai.usage.input_tokens': 100,
        'gen_ai.usage.output_tokens': 40,
      }),
    ).toMatchObject({ inputTokens: 100, outputTokens: 40 });
  });

  it('falls back to legacy ai.usage.* (prompt/completion)', () => {
    expect(
      extractAiSdkUsage({
        'ai.usage.promptTokens': 12,
        'ai.usage.completionTokens': 7,
      }),
    ).toMatchObject({ inputTokens: 12, outputTokens: 7 });
  });

  it('returns undefined when no usage present', () => {
    expect(extractAiSdkUsage({ 'some.other.attr': 1 })).toBeUndefined();
  });
});

describe('mapAiSdkAttributes', () => {
  it('rewrites legacy ai.* to canonical gen_ai.*', () => {
    expect(
      mapAiSdkAttributes({
        'ai.model.id': 'gpt-4o',
        'ai.model.provider': 'openai.chat',
        'ai.response.finishReason': 'stop',
        'ai.usage.promptTokens': 100,
        'ai.usage.completionTokens': 50,
        'ai.telemetry.functionId': 'summarize',
      }),
    ).toEqual({
      'gen_ai.request.model': 'gpt-4o',
      'gen_ai.provider.name': 'openai',
      'gen_ai.response.finish_reasons': ['stop'],
      'gen_ai.agent.name': 'summarize',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 50,
    });
  });
});

describe('cost from AI SDK attributes', () => {
  it('estimates cost from model + usage', () => {
    expect(
      estimateAiSdkCost({
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.usage.input_tokens': 1000,
        'gen_ai.usage.output_tokens': 500,
      }),
    ).toBe(0.0075);
  });

  it('records cost on a wrapping context', () => {
    const setAttribute = vi.fn();
    const cost = recordAiSdkCost({ setAttribute }, {
      'ai.model.id': 'gpt-4o',
      'ai.usage.promptTokens': 1000,
      'ai.usage.completionTokens': 500,
    });
    expect(cost).toBe(0.0075);
    expect(setAttribute).toHaveBeenCalledWith('gen_ai.usage.cost.usd', 0.0075);
  });

  it('extractAiSdkModel prefers canonical', () => {
    expect(
      extractAiSdkModel({ 'gen_ai.request.model': 'a', 'ai.model.id': 'b' }),
    ).toBe('a');
  });
});

describe('autotelEnrich', () => {
  it('stamps a provenance marker and merges mapped attributes', () => {
    const enrich = autotelEnrich({
      attributes: (ctx) => ({ 'app.session': String(ctx.runtimeContext?.sessionId) }),
    });
    const attrs = enrich({
      spanType: 'languageModel',
      operationId: 'ai.generateText',
      callId: 'c1',
      runtimeContext: { sessionId: 's1' },
    });
    expect(attrs[AUTOTEL_ENRICHED_ATTR]).toBe(true);
    expect(attrs['app.session']).toBe('s1');
  });

  it('works with no attributes mapper', () => {
    const attrs = autotelEnrich()({
      spanType: 'operation',
      operationId: 'ai.streamText',
      callId: 'c2',
    });
    expect(attrs).toEqual({ [AUTOTEL_ENRICHED_ATTR]: true });
  });
});
