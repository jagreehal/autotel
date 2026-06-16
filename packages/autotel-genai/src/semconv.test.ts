import { describe, expect, it } from 'vitest';
import {
  GEN_AI,
  GEN_AI_EVENT,
  GEN_AI_METRIC,
  GEN_AI_OPERATION,
  GEN_AI_PROVIDER,
  genAiSpanName,
} from './semconv.js';

describe('canonical attribute keys', () => {
  it('uses the underscore `gen_ai.*` namespace, never `gen.ai.*`', () => {
    for (const value of Object.values(GEN_AI)) {
      expect(
        value.startsWith('gen_ai.') ||
          value === 'server.address' ||
          value === 'server.port',
      ).toBe(true);
      expect(value).not.toContain('gen.ai.');
    }
  });

  it('uses input_tokens / output_tokens, not prompt/completion', () => {
    expect(GEN_AI.USAGE_INPUT_TOKENS).toBe('gen_ai.usage.input_tokens');
    expect(GEN_AI.USAGE_OUTPUT_TOKENS).toBe('gen_ai.usage.output_tokens');
    const joined = Object.values(GEN_AI).join(',');
    expect(joined).not.toContain('prompt_tokens');
    expect(joined).not.toContain('completion_tokens');
    expect(joined).not.toContain('total_tokens');
  });

  it('exposes provider.name (not the deprecated system)', () => {
    expect(GEN_AI.PROVIDER_NAME).toBe('gen_ai.provider.name');
  });

  it('exposes server endpoint keys used by client spans', () => {
    expect(GEN_AI.SERVER_ADDRESS).toBe('server.address');
    expect(GEN_AI.SERVER_PORT).toBe('server.port');
  });
});

describe('enums', () => {
  it('includes the agent + tool operations', () => {
    expect(GEN_AI_OPERATION.INVOKE_AGENT).toBe('invoke_agent');
    expect(GEN_AI_OPERATION.CREATE_AGENT).toBe('create_agent');
    expect(GEN_AI_OPERATION.EXECUTE_TOOL).toBe('execute_tool');
    expect(GEN_AI_OPERATION.PLAN).toBe('plan');
  });

  it('maps well-known providers to canonical values', () => {
    expect(GEN_AI_PROVIDER.AWS_BEDROCK).toBe('aws.bedrock');
    expect(GEN_AI_PROVIDER.GCP_GEMINI).toBe('gcp.gemini');
    expect(GEN_AI_PROVIDER.MOONSHOT_AI).toBe('moonshot_ai');
  });

  it('names the canonical client metrics', () => {
    expect(GEN_AI_METRIC.TOKEN_USAGE).toBe('gen_ai.client.token.usage');
    expect(GEN_AI_METRIC.OPERATION_DURATION).toBe(
      'gen_ai.client.operation.duration',
    );
    expect(GEN_AI_METRIC.TIME_TO_FIRST_CHUNK).toBe(
      'gen_ai.client.operation.time_to_first_chunk',
    );
  });

  it('names the canonical GenAI events', () => {
    expect(GEN_AI_EVENT.INFERENCE_OPERATION_DETAILS).toBe(
      'gen_ai.client.inference.operation.details',
    );
    expect(GEN_AI_EVENT.CLIENT_OPERATION_EXCEPTION).toBe(
      'gen_ai.client.operation.exception',
    );
  });
});

describe('genAiSpanName', () => {
  it('joins operation and identifier', () => {
    expect(genAiSpanName('chat', 'gpt-4o')).toBe('chat gpt-4o');
    expect(genAiSpanName('execute_tool', 'get_weather')).toBe(
      'execute_tool get_weather',
    );
  });

  it('falls back to the bare operation when no identifier', () => {
    expect(genAiSpanName('invoke_agent')).toBe('invoke_agent');
    expect(genAiSpanName('chat', '   ')).toBe('chat');
  });
});
