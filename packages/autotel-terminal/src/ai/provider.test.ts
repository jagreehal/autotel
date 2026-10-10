import { afterEach, describe, expect, it } from 'vitest';
import type { LanguageModel } from 'ai';
import {
  createAIModel,
  loadProvider,
  parseModelSpec,
  resolveAIModel,
  resolveConfig,
  resolveConfigWithAutoDetect,
} from './provider';

const noOllama = { detectOllama: async () => false };

describe('AI provider config', () => {
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  it('parses model specs, splitting only a known provider prefix', () => {
    expect(parseModelSpec('ollama:qwen2:latest')).toEqual({
      provider: 'ollama',
      model: 'qwen2:latest',
    });
    expect(parseModelSpec('openai:gpt-5')).toEqual({
      provider: 'openai',
      model: 'gpt-5',
    });
    expect(parseModelSpec('openai-compatible:qwen3')).toEqual({
      provider: 'openai-compatible',
      model: 'qwen3',
    });
    expect(parseModelSpec('gateway:openai/gpt-5')).toEqual({
      provider: 'gateway',
      model: 'openai/gpt-5',
    });
    expect(parseModelSpec('anthropic/claude-x')).toEqual({
      provider: 'gateway',
      model: 'anthropic/claude-x',
    });
  });

  it('reads a spec from --model or AI_MODEL', () => {
    expect(resolveConfig({ model: 'openai:gpt-5' })).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
    });
    process.env.AI_MODEL = 'ollama:granite4';
    expect(resolveConfig()).toMatchObject({
      provider: 'ollama',
      model: 'granite4',
    });
  });

  it('lets a prefixed --model win over AI_PROVIDER', () => {
    process.env.AI_PROVIDER = 'ollama';
    expect(resolveConfig({ model: 'openai:gpt-5' })).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
    });
  });

  it('keeps --ai-provider/--ai-model and AI_API_KEY working', () => {
    process.env.AI_API_KEY = 'shared';
    expect(resolveConfig({ provider: 'openai', model: 'gpt-5' })).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'shared',
      baseUrl: undefined,
    });
  });

  it('has no default remote model', () => {
    process.env.OPENAI_API_KEY = 'openai-secret';
    expect(() => resolveConfig({ provider: 'openai' })).toThrow(
      /No model named for openai/,
    );
    // Only a local Ollama has a default.
    expect(resolveConfig({ provider: 'ollama' })).toMatchObject({
      model: 'granite4',
    });
  });

  it('stays unconfigured with only OPENAI_API_KEY and no Ollama', async () => {
    process.env.OPENAI_API_KEY = 'openai-secret';
    expect(await resolveConfigWithAutoDetect({}, noOllama)).toBeNull();
    expect(await resolveAIModel({}, noOllama)).toBeNull();
  });

  it('falls back to a local Ollama when one answers', async () => {
    expect(
      await resolveConfigWithAutoDetect({}, { detectOllama: async () => true }),
    ).toMatchObject({ provider: 'ollama', model: 'granite4' });
  });

  it('uses a caller-built AI SDK model as-is', async () => {
    // SAFETY: only `provider` is read off a caller's model.
    const model = { provider: 'acme.chat' } as Exclude<LanguageModel, string>;
    expect(await resolveAIModel({ model }, noOllama)).toEqual({
      model,
      providerType: 'custom',
    });
    // SAFETY: as above.
    const ollama = { provider: 'ollama.chat' } as Exclude<
      LanguageModel,
      string
    >;
    const ollamaResult = await resolveAIModel({ model: ollama });
    expect(ollamaResult?.providerType).toBe('ollama');
  });

  it('builds a gateway model from a bare id', async () => {
    const result = await resolveAIModel({ model: 'openai/gpt-5' }, noOllama);
    expect(result?.providerType).toBe('gateway');
    expect(result?.model).toMatchObject({ modelId: 'openai/gpt-5' });
  });

  it('names the package to install when a provider is missing', async () => {
    const notFound = Object.assign(
      new Error("Cannot find package 'ai-sdk-ollama' imported from x.js"),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );
    await expect(
      loadProvider('ai-sdk-ollama', () => Promise.reject(notFound)),
    ).rejects.toThrow('Run: npm install ai-sdk-ollama');
    // Any other failure is passed through untouched.
    const other = new Error('boom');
    await expect(
      loadProvider('ai-sdk-ollama', () => Promise.reject(other)),
    ).rejects.toBe(other);
  });

  it('throws for unsupported provider values', async () => {
    await expect(
      // SAFETY: forcing past the compiler is the point - the runtime must
      // reject a provider name a JavaScript caller could pass.
      createAIModel({ provider: 'invalid' as never, model: 'test-model' }),
    ).rejects.toThrow(/unsupported provider/i);
  });
});
