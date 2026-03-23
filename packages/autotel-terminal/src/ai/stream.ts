/**
 * Provider-aware streamText wrapper.
 *
 * When the provider is Ollama, uses ai-sdk-ollama's streamText which has
 * enhanced response synthesis for tool calling (Ollama models often return
 * empty text after tool execution — the enhanced version detects this and
 * synthesizes a response from tool results).
 *
 * For all other providers, uses the standard ai SDK streamText.
 */
import type { LanguageModel } from 'ai';
import type { AIProviderType } from './types';

type StreamTextParams = {
  model: LanguageModel;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools?: Record<string, unknown>;
  maxSteps?: number;
  abortSignal?: AbortSignal;
};

type StreamResult = {
  textStream: AsyncIterable<string>;
};

export async function providerStreamText(
  providerType: AIProviderType,
  params: StreamTextParams,
): Promise<StreamResult> {
  if (providerType === 'ollama') {
    const mod = await import('ai-sdk-ollama');
    // ai-sdk-ollama's streamText has enhanced synthesis for tool calling
    const result = await mod.streamText(
      params as Parameters<typeof mod.streamText>[0],
    );
    return result as unknown as StreamResult;
  }

  const mod = await import('ai');
  return mod.streamText(
    params as Parameters<typeof mod.streamText>[0],
  ) as unknown as StreamResult;
}
