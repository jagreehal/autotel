/**
 * `autotel-genai/observer` — event-stream → `gen_ai.*` span adapter.
 *
 * Subscribe {@link createGenAiObserver} to a framework's lifecycle event stream
 * to get a canonical GenAI span tree without wrapping each call yourself.
 */

export { createGenAiObserver } from './observer.js';
export { SpanRegistry } from './span-registry.js';
export { observeAiSdkResult } from './ai-sdk.js';
export type {
  AiSdkResult,
  AiSdkStep,
  AiSdkToolCall,
  AiSdkToolResult,
  AiSdkUsage,
  ObserveAiSdkOptions,
} from './ai-sdk.js';
export { createLangChainObserver } from './langchain.js';
export type {
  LangChainObserverHandler,
  LangChainObserverOptions,
} from './langchain.js';
export type {
  AgentEndEvent,
  AgentStartEvent,
  ChatEndEvent,
  ChatStartEvent,
  GenAiObserver,
  GenAiObserverEvent,
  GenAiObserverOptions,
  GenAiToolIdentity,
  SpanEnd,
  SpanStart,
  ToolEndEvent,
  ToolStartEvent,
  WorkflowEndEvent,
  WorkflowStartEvent,
} from './types.js';
