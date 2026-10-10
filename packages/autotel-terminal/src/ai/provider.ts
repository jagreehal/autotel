import type { LanguageModel } from 'ai';
import type { AIConfig, AIOptions, AIProviderType } from './types';

const PROVIDERS: readonly AIProviderType[] = [
  'ollama',
  'openai',
  'openai-compatible',
  'gateway',
];

/** The local model used when Ollama is chosen or detected without one named. */
const OLLAMA_DEFAULT_MODEL = 'granite4';

/** How to configure a model, for the unconfigured view and error messages. */
export const MODEL_HINT =
  'Pass --model (ollama:<id>, openai:<id>, openai-compatible:<id> with --base-url, or a gateway id like openai/gpt-5), set AI_MODEL, or start Ollama locally.';

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

/**
 * `ollama:qwen2:latest` → ollama + `qwen2:latest`. Only a known provider
 * prefix is split off; anything else is a gateway id (`openai/gpt-5`).
 */
export function parseModelSpec(spec: string): {
  provider: AIProviderType;
  model: string;
} {
  const colon = spec.indexOf(':');
  const prefix = colon === -1 ? '' : spec.slice(0, colon);
  const provider = PROVIDERS.find((p) => p === prefix);
  return provider
    ? { provider, model: spec.slice(colon + 1) }
    : { provider: 'gateway', model: spec };
}

/**
 * The config named by options and env, or null when nothing is named.
 * A model with a provider prefix (`openai:gpt-5`) names its own provider.
 * Otherwise `provider` + `model` (and `AI_PROVIDER` + `AI_MODEL`) still work,
 * and a model without a provider is read as a gateway id. Only Ollama has a
 * default model: a remote provider must be told which model to bill.
 */
export function resolveConfig(
  options: Partial<AIConfig> = {},
): AIConfig | null {
  const rawModel = options.model ?? process.env.AI_MODEL;
  const spec = rawModel === undefined ? undefined : parseModelSpec(rawModel);
  const prefixed = spec !== undefined && spec.model !== rawModel;
  let provider: AIProviderType | undefined = prefixed
    ? spec.provider
    : (options.provider ??
      // SAFETY: AI_PROVIDER arrives from the environment as a string;
      // createAIModel rejects a value that names no provider.
      (process.env.AI_PROVIDER as AIProviderType | undefined));
  let model = prefixed ? spec.model : rawModel;
  if (!provider && spec) ({ provider, model } = spec);
  if (!provider) return null;

  model ??= provider === 'ollama' ? OLLAMA_DEFAULT_MODEL : undefined;
  if (!model) {
    throw new Error(`No model named for ${provider}. ${MODEL_HINT}`);
  }
  return {
    provider,
    model,
    apiKey: options.apiKey ?? process.env.AI_API_KEY,
    baseUrl: options.baseUrl ?? process.env.AI_BASE_URL,
  };
}

const defaultAutoDetectDeps = { detectOllama };

/** {@link resolveConfig}, falling back to a local Ollama when one answers. */
export async function resolveConfigWithAutoDetect(
  options: Partial<AIConfig> = {},
  deps: { detectOllama: typeof detectOllama } = defaultAutoDetectDeps,
): Promise<AIConfig | null> {
  const config = resolveConfig(options);
  if (config) return config;

  const ollamaUrl =
    options.baseUrl ?? process.env.AI_BASE_URL ?? 'http://127.0.0.1:11434';
  if (await deps.detectOllama(ollamaUrl)) {
    return {
      provider: 'ollama',
      model: OLLAMA_DEFAULT_MODEL,
      baseUrl: ollamaUrl,
    };
  }
  return null;
}

export type AIModelResult = {
  model: LanguageModel;
  /** `custom` for a model the caller built; it streams through the AI SDK. */
  providerType: AIProviderType | 'custom';
};

/**
 * Imports an optional provider package, turning "not installed" into an
 * error that names the package to add.
 */
export async function loadProvider<T>(
  pkg: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const missing =
      (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') &&
      String((error as Error).message).includes(pkg);
    if (!missing) throw error;
    throw new Error(
      `This model needs ${pkg}, which is not installed. Run: npm install ${pkg}`,
      { cause: error },
    );
  }
}

export async function createAIModel(config: AIConfig): Promise<AIModelResult> {
  switch (config.provider) {
    case 'ollama': {
      const { createOllama } = await loadProvider(
        'ai-sdk-ollama',
        () => import('ai-sdk-ollama'),
      );
      const ollama = createOllama({
        baseURL: config.baseUrl ?? 'http://127.0.0.1:11434',
      });
      return { model: ollama(config.model), providerType: 'ollama' };
    }
    case 'openai': {
      const { createOpenAI } = await loadProvider(
        '@ai-sdk/openai',
        () => import('@ai-sdk/openai'),
      );
      // Without an apiKey the provider reads OPENAI_API_KEY itself.
      const openai = createOpenAI({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return { model: openai(config.model), providerType: 'openai' };
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } = await loadProvider(
        '@ai-sdk/openai-compatible',
        () => import('@ai-sdk/openai-compatible'),
      );
      const provider = createOpenAICompatible({
        baseURL: config.baseUrl ?? 'http://127.0.0.1:11434/v1',
        name: 'custom',
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      });
      return {
        model: provider(config.model),
        providerType: 'openai-compatible',
      };
    }
    case 'gateway': {
      // Without an apiKey the gateway reads AI_GATEWAY_API_KEY, or a Vercel
      // OIDC token.
      const { createGateway, gateway } = await import('ai');
      // AI_BASE_URL points at a self-hosted model, so the gateway ignores it.
      const provider = config.apiKey
        ? createGateway({ apiKey: config.apiKey })
        : gateway;
      return { model: provider(config.model), providerType: 'gateway' };
    }
    default: {
      throw new Error(
        `Unsupported provider: "${String(config.provider)}". Expected one of ${PROVIDERS.join(', ')}.`,
      );
    }
  }
}

/**
 * The model the dashboard talks to: the caller's own AI SDK model as-is, else
 * one built from a spec, env or a detected Ollama. Null when none is set.
 */
export async function resolveAIModel(
  options: AIOptions = {},
  deps: { detectOllama: typeof detectOllama } = defaultAutoDetectDeps,
): Promise<AIModelResult | null> {
  const { model, ...rest } = options;
  if (model !== undefined && typeof model !== 'string') {
    // ai-sdk-ollama's streamText repairs empty replies after tool calls.
    const isOllama = model.provider.startsWith('ollama');
    return { model, providerType: isOllama ? 'ollama' : 'custom' };
  }
  const config = await resolveConfigWithAutoDetect({ ...rest, model }, deps);
  return config ? createAIModel(config) : null;
}
