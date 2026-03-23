import { afterEach, describe, expect, it } from 'vitest';
import {
  createAIModel,
  resolveConfig,
  resolveConfigWithAutoDetect,
} from './provider';

describe('AI provider config', () => {
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  it('uses OPENAI_API_KEY when openai is explicitly selected', () => {
    process.env.OPENAI_API_KEY = 'openai-secret';

    expect(resolveConfig({ provider: 'openai' })).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'openai-secret',
    });
  });

  it('uses OPENAI_API_KEY when auto-detect resolves to openai', async () => {
    process.env.OPENAI_API_KEY = 'openai-secret';

    const result = await resolveConfigWithAutoDetect(
      {},
      { detectOllama: async () => false },
    );

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'openai-secret',
    });
  });

  it('throws for unsupported provider values', async () => {
    await expect(
      createAIModel({ provider: 'invalid' as never, model: 'test-model' }),
    ).rejects.toThrow(/unsupported provider/i);
  });
});
