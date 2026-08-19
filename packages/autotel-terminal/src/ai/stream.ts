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

/** A tool as the AI SDK takes one: a description plus a parameter schema. */
type AiTool = {
  description?: string;
  parameters?: unknown;
  execute?: (...args: never[]) => unknown;
};

type StreamTextParams = {
  model: LanguageModel;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools?: Record<string, AiTool>;
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
      // SAFETY: the params are built from this module's own options; the SDK's
      // parameter type is generic over a tool set we do not name.
      params as Parameters<typeof mod.streamText>[0],
    );
    // SAFETY: StreamResult names the three members the terminal consumes off a
    // stream; the SDK's own result type is generic over the tool set.
    return result as unknown as StreamResult;
  }

  const mod = await import('ai');
  return mod.streamText(
    params as Parameters<typeof mod.streamText>[0],
  ) as unknown as StreamResult;
}
