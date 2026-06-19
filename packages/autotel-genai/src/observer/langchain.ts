/**
 * LangChain / LangGraph → {@link createGenAiObserver} glue.
 *
 * LangChain's callback system is a real event stream: register one handler and
 * it receives every run's start/end/error with a `runId` and `parentRunId` —
 * which map directly onto the observer's `id` / `parentId`. {@link
 * createLangChainObserver} returns a handler object you pass to `callbacks`:
 *
 *   - chain runs (LangGraph nodes, agents) → `invoke_agent` spans;
 *   - LLM / chat-model runs → `chat` spans (with usage and estimated cost);
 *   - tool runs → `execute_tool` spans.
 *
 * Typed structurally against the callback payloads so it pulls in no LangChain
 * dependency. Pass it via `{ callbacks: [createLangChainObserver(observe)] }`.
 *
 * @example
 * ```ts
 * const observe = createGenAiObserver();
 * await graph.invoke(input, { callbacks: [createLangChainObserver(observe)] });
 * ```
 */

import { normalizeAiSdkProvider } from '../ai-sdk-bridge.js';
import type { TokenUsage } from '../cost.js';
import type { GenAiObserver } from './types.js';

/** LangChain `Serialized` — the identity of a chain/LLM/tool. */
interface Serialized {
  id?: string[];
  name?: string;
  kwargs?: Record<string, unknown>;
}

interface LLMGeneration {
  generationInfo?: Record<string, unknown>;
  message?: {
    usage_metadata?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
  };
}

/** LangChain `LLMResult` — what an LLM/chat-model run returns. */
interface LLMResult {
  generations?: LLMGeneration[][];
  llmOutput?: Record<string, unknown>;
}

/** The subset of LangChain's `CallbackHandlerMethods` this adapter implements. */
export interface LangChainObserverHandler {
  handleChainStart(
    chain: Serialized,
    inputs: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string,
  ): void;
  handleChainEnd(outputs: unknown, runId: string): void;
  handleChainError(error: unknown, runId: string): void;
  handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void;
  handleChatModelStart(
    llm: Serialized,
    messages: unknown,
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void;
  handleLLMEnd(output: LLMResult, runId: string): void;
  handleLLMError(error: unknown, runId: string): void;
  handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): void;
  handleToolEnd(output: unknown, runId: string): void;
  handleToolError(error: unknown, runId: string): void;
}

export interface LangChainObserverOptions {
  /**
   * Decide whether a chain run becomes an `invoke_agent` span. The default
   * skips LangChain/LangGraph plumbing (Runnable*, ChannelWrite, Branch,
   * prompts, `__start__`/`__end__`) so only the graph and its named nodes show;
   * children of a skipped chain reparent to the nearest kept ancestor.
   */
  skipChain?: (name: string) => boolean;
}

/** LangChain/LangGraph structural runnables that are noise, not real steps. */
const PLUMBING_CHAIN = /^(Runnable|Channel|Branch|Prompt|ChatPrompt|__)/i;

export function createLangChainObserver(
  observe: GenAiObserver,
  options: LangChainObserverOptions = {},
): LangChainObserverHandler {
  const skipChain = options.skipChain ?? ((name) => PLUMBING_CHAIN.test(name));
  // Remember each LLM run's request model so `chat.end` can price it — the end
  // payload doesn't reliably carry the model. Cleared on end and error.
  const models = new Map<string, string>();
  // Skipped chains record the kept ancestor their children should parent to.
  const reparented = new Map<string, string | undefined>();

  /** The span id a child of `runId` should use as its parent. */
  function keptParent(runId: string | undefined): string | undefined {
    if (runId === undefined) return undefined;
    return reparented.has(runId) ? reparented.get(runId) : runId;
  }

  function startChat(
    llm: Serialized,
    runId: string,
    parentRunId: string | undefined,
    extraParams: Record<string, unknown> | undefined,
  ): void {
    const model = langChainModel(llm, extraParams);
    if (model) models.set(runId, model);
    observe({
      type: 'chat.start',
      id: runId,
      parentId: keptParent(parentRunId),
      request: { provider: langChainProvider(llm), model },
    });
  }

  return {
    handleChainStart(
      chain,
      _inputs,
      runId,
      parentRunId,
      _tags,
      _metadata,
      _runType,
      runName,
    ) {
      const name = runName ?? lastIdSegment(chain) ?? 'chain';
      const parentId = keptParent(parentRunId);
      if (skipChain(name)) {
        reparented.set(runId, parentId);
        return;
      }
      observe({ type: 'agent.start', id: runId, parentId, agent: { name } });
    },
    handleChainEnd(_outputs, runId) {
      if (reparented.delete(runId)) return;
      observe({ type: 'agent.end', id: runId });
    },
    handleChainError(error, runId) {
      if (reparented.delete(runId)) return;
      observe({ type: 'agent.end', id: runId, error });
    },

    handleLLMStart(llm, _prompts, runId, parentRunId, extraParams) {
      startChat(llm, runId, parentRunId, extraParams);
    },
    handleChatModelStart(llm, _messages, runId, parentRunId, extraParams) {
      startChat(llm, runId, parentRunId, extraParams);
    },
    handleLLMEnd(output, runId) {
      const costModel = models.get(runId);
      models.delete(runId);
      observe({
        type: 'chat.end',
        id: runId,
        response: { finishReasons: finishReasons(output) },
        usage: langChainUsage(output),
        costModel,
      });
    },
    handleLLMError(error, runId) {
      models.delete(runId);
      observe({ type: 'chat.end', id: runId, error });
    },

    handleToolStart(
      tool,
      input,
      runId,
      parentRunId,
      _tags,
      _metadata,
      runName,
    ) {
      observe({
        type: 'tool.start',
        id: runId,
        parentId: keptParent(parentRunId),
        tool: { name: runName ?? lastIdSegment(tool) },
        callArguments: input,
      });
    },
    handleToolEnd(output, runId) {
      observe({ type: 'tool.end', id: runId, callResult: output });
    },
    handleToolError(error, runId) {
      observe({ type: 'tool.end', id: runId, error });
    },
  };
}

/**
 * Provider from a `Serialized.id` path. LangChain serializes a chat model as
 * `[...namespace, provider, ClassName]` (e.g. `…, 'openai', 'ChatOpenAI'`), so
 * the provider is the lowercase module segment before the PascalCase class.
 */
function langChainProvider(serialized: Serialized): string | undefined {
  const candidate = serialized.id?.at(-2);
  return candidate && candidate === candidate.toLowerCase()
    ? normalizeAiSdkProvider(candidate)
    : undefined;
}

function langChainModel(
  serialized: Serialized,
  extraParams: Record<string, unknown> | undefined,
): string | undefined {
  const invocation = asRecord(extraParams?.invocation_params);
  return (
    str(invocation?.model) ??
    str(invocation?.model_name) ??
    str(serialized.kwargs?.model) ??
    str(serialized.kwargs?.model_name)
  );
}

function langChainUsage(output: LLMResult): TokenUsage | undefined {
  // `usage_metadata` is LangChain's canonical cross-provider shape (Ollama,
  // newer integrations); `llmOutput.tokenUsage` is OpenAI; `llmOutput.usage`
  // is Anthropic-style.
  const usageMetadata = asRecord(
    firstGeneration(output)?.message?.usage_metadata,
  );
  const tokenUsage = asRecord(output.llmOutput?.tokenUsage);
  const usage = asRecord(output.llmOutput?.usage);
  const inputTokens =
    num(usageMetadata?.input_tokens) ??
    num(tokenUsage?.promptTokens) ??
    num(usage?.input_tokens);
  const outputTokens =
    num(usageMetadata?.output_tokens) ??
    num(tokenUsage?.completionTokens) ??
    num(usage?.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}

function finishReasons(output: LLMResult): string[] | undefined {
  const generation = firstGeneration(output);
  const reason =
    str(generation?.generationInfo?.finish_reason) ??
    str(asRecord(generation?.message?.response_metadata)?.done_reason);
  return reason ? [reason] : undefined;
}

function firstGeneration(output: LLMResult): LLMGeneration | undefined {
  return output.generations?.[0]?.[0];
}

function lastIdSegment(serialized: Serialized): string | undefined {
  return serialized.name ?? serialized.id?.at(-1);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
