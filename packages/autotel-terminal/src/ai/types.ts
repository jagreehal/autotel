import type { LanguageModel } from 'ai';

export type AIProviderType =
  'ollama' | 'openai' | 'openai-compatible' | 'gateway';

export type AIConfig = {
  provider: AIProviderType;
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

/**
 * The `ai` option of `renderTerminal`. `model` is either any AI SDK model,
 * used as-is (`openai('gpt-5')`, `gateway('openai/gpt-5')`, an Ollama model),
 * or a spec string: `ollama:<id>`, `openai:<id>`, `openai-compatible:<id>`
 * (with `baseUrl`), or a gateway id (`openai/gpt-5`, optionally `gateway:`).
 */
export type AIOptions = Partial<Omit<AIConfig, 'model'>> & {
  model?: string | Exclude<LanguageModel, string>;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AIState =
  | { status: 'unconfigured' }
  | { status: 'idle' }
  | { status: 'streaming'; abortController: AbortController }
  | { status: 'error'; message: string };

/** json-render spec for rich AI output — re-export from @json-render/ink */
export type { InkSpec } from '@json-render/ink';
