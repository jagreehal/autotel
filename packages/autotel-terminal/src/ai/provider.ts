import type { LanguageModel } from 'ai';
import type { AIConfig, AIProviderType } from './types';

export async function detectOllama(
  baseUrl = 'http://127.0.0.1:11434',
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function resolveConfig(
  options: Partial<AIConfig> = {},
): AIConfig | null {
  const provider: AIProviderType | undefined =
    options.provider ??
    (process.env.AI_PROVIDER as AIProviderType | undefined) ??
    undefined;

  const model = options.model ?? process.env.AI_MODEL;
  const apiKey =
    options.apiKey ??
    process.env.AI_API_KEY ??
    (provider === 'openai' ? process.env.OPENAI_API_KEY : undefined);
  const baseUrl = options.baseUrl ?? process.env.AI_BASE_URL;

  if (provider) {
    return {
      provider,
      model: model ?? (provider === 'ollama' ? 'granite4' : 'gpt-4o'),
      apiKey,
      baseUrl,
    };
  }

  // Will be resolved async in resolveConfigWithAutoDetect
  return null;
}

const defaultAutoDetectDeps = { detectOllama };

export async function resolveConfigWithAutoDetect(
  options: Partial<AIConfig> = {},
  deps: { detectOllama: typeof detectOllama } = defaultAutoDetectDeps,
): Promise<AIConfig | null> {
  const config = resolveConfig(options);
  if (config) return config;

  // Auto-detect: check Ollama first
  const ollamaUrl =
    options.baseUrl ?? process.env.AI_BASE_URL ?? 'http://127.0.0.1:11434';
  if (await deps.detectOllama(ollamaUrl)) {
    return {
      provider: 'ollama',
      model: options.model ?? process.env.AI_MODEL ?? 'granite4',
      baseUrl: ollamaUrl,
    };
  }

  // Check for OpenAI key
  const openaiKey =
    options.apiKey ?? process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: 'openai',
      model: options.model ?? process.env.AI_MODEL ?? 'gpt-4o',
      apiKey: openaiKey,
    };
  }

  return null;
}

export type AIModelResult = {
  model: LanguageModel;
  providerType: AIProviderType;
  config: AIConfig;
};

export async function createAIModel(config: AIConfig): Promise<AIModelResult> {
  switch (config.provider) {
    case 'ollama': {
      const { createOllama } = await import('ai-sdk-ollama');
      const ollama = createOllama({
        baseURL: config.baseUrl ?? 'http://127.0.0.1:11434',
      });
      return { model: ollama(config.model), providerType: 'ollama', config };
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const openai = createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return { model: openai(config.model), providerType: 'openai', config };
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } =
        await import('@ai-sdk/openai-compatible');
      const provider = createOpenAICompatible({
        baseURL: config.baseUrl ?? 'http://127.0.0.1:11434/v1',
        name: 'custom',
        ...(config.apiKey
          ? { headers: { Authorization: `Bearer ${config.apiKey}` } }
          : {}),
      });
      return {
        model: provider(config.model),
        providerType: 'openai-compatible',
        config,
      };
    }
    default: {
      throw new Error(
        `Unsupported provider: "${config.provider}". Expected "ollama", "openai", or "openai-compatible".`,
      );
    }
  }
}
