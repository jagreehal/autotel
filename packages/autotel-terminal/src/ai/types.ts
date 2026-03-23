export type AIProviderType = 'ollama' | 'openai' | 'openai-compatible';

export type AIConfig = {
  provider: AIProviderType;
  model: string;
  apiKey?: string;
  baseUrl?: string;
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
