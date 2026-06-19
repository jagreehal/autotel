import { describe, expect, it } from 'vitest';
import { createLangChainObserver } from './langchain.js';
import type { GenAiObserverEvent } from './types.js';

function collect() {
  const events: GenAiObserverEvent[] = [];
  const observe = (event: GenAiObserverEvent) => events.push(event);
  return { events, observe, handler: createLangChainObserver(observe) };
}

const openaiLlm = {
  id: ['langchain', 'chat_models', 'openai', 'ChatOpenAI'],
  kwargs: { model: 'gpt-4o' },
};

describe('createLangChainObserver', () => {
  it('maps a chain run to an agent span keyed by runId/parentRunId', () => {
    const { events, handler } = collect();
    handler.handleChainStart(
      { id: ['langgraph', 'graph'], name: 'agent' },
      {},
      'chain-1',
    );
    handler.handleChainEnd({}, 'chain-1');

    // `toEqual` ignores the undefined-valued `parentId` the adapter emits.
    expect(events).toEqual([
      { type: 'agent.start', id: 'chain-1', agent: { name: 'agent' } },
      { type: 'agent.end', id: 'chain-1' },
    ]);
  });

  it('maps an LLM run to a chat span with provider, model, usage and cost model', () => {
    const { events, handler } = collect();
    handler.handleLLMStart(openaiLlm, ['hi'], 'llm-1', 'chain-1', {
      invocation_params: { model: 'gpt-4o' },
    });
    handler.handleLLMEnd(
      {
        generations: [[{ generationInfo: { finish_reason: 'stop' } }]],
        llmOutput: { tokenUsage: { promptTokens: 12, completionTokens: 8 } },
      },
      'llm-1',
    );

    expect(events[0]).toEqual({
      type: 'chat.start',
      id: 'llm-1',
      parentId: 'chain-1',
      request: { provider: 'openai', model: 'gpt-4o' },
    });
    expect(events[1]).toMatchObject({
      type: 'chat.end',
      id: 'llm-1',
      response: { finishReasons: ['stop'] },
      usage: { inputTokens: 12, outputTokens: 8 },
      costModel: 'gpt-4o',
    });
  });

  it('reads Anthropic-style usage field names', () => {
    const { events, handler } = collect();
    handler.handleChatModelStart(openaiLlm, [], 'llm-2');
    handler.handleLLMEnd(
      { llmOutput: { usage: { input_tokens: 5, output_tokens: 7 } } },
      'llm-2',
    );
    expect(events[1]).toMatchObject({
      usage: { inputTokens: 5, outputTokens: 7 },
    });
  });

  it('reads Ollama-style usage_metadata and done_reason from the generation', () => {
    const { events, handler } = collect();
    handler.handleChatModelStart(openaiLlm, [], 'llm-3');
    handler.handleLLMEnd(
      {
        generations: [
          [
            {
              message: {
                usage_metadata: { input_tokens: 35, output_tokens: 43 },
                response_metadata: { done_reason: 'stop' },
              },
            },
          ],
        ],
      },
      'llm-3',
    );
    expect(events[1]).toMatchObject({
      usage: { inputTokens: 35, outputTokens: 43 },
      response: { finishReasons: ['stop'] },
    });
  });

  it('maps a tool run to a tool span with arguments and result as content', () => {
    const { events, handler } = collect();
    handler.handleToolStart(
      { id: ['langchain', 'tools', 'Tool'], name: 'search' },
      'otel query',
      'tool-1',
      'llm-1',
    );
    handler.handleToolEnd('3 results', 'tool-1');

    expect(events[0]).toEqual({
      type: 'tool.start',
      id: 'tool-1',
      parentId: 'llm-1',
      tool: { name: 'search' },
      callArguments: 'otel query',
    });
    expect(events[1]).toEqual({
      type: 'tool.end',
      id: 'tool-1',
      callResult: '3 results',
    });
  });

  it('threads errors through end events', () => {
    const { events, handler } = collect();
    const error = new Error('boom');
    handler.handleChainStart({ name: 'g' }, {}, 'c');
    handler.handleLLMStart(openaiLlm, [], 'l', 'c');
    handler.handleLLMError(error, 'l');
    handler.handleChainError(error, 'c');

    expect(events[2]).toEqual({ type: 'chat.end', id: 'l', error });
    expect(events[3]).toEqual({ type: 'agent.end', id: 'c', error });
  });

  it('skips plumbing chains and reparents their children to the nearest kept chain', () => {
    const { events, handler } = collect();
    const node = { id: ['langgraph'] };
    handler.handleChainStart(
      node,
      {},
      'graph',
      undefined,
      [],
      {},
      'chain',
      'LangGraph',
    );
    handler.handleChainStart(
      node,
      {},
      'seq',
      'graph',
      [],
      {},
      'chain',
      'RunnableSequence',
    );
    handler.handleChatModelStart(openaiLlm, [], 'llm', 'seq', {
      invocation_params: { model: 'gpt-4o' },
    });
    handler.handleLLMEnd(
      {
        generations: [
          [
            {
              message: {
                usage_metadata: { input_tokens: 1, output_tokens: 1 },
              },
            },
          ],
        ],
      },
      'llm',
    );
    handler.handleChainEnd({}, 'seq');
    handler.handleChainEnd({}, 'graph');

    // Only the graph becomes an agent span; RunnableSequence is dropped.
    const agentStarts = events.filter((e) => e.type === 'agent.start');
    expect(agentStarts).toHaveLength(1);
    expect(agentStarts[0]).toMatchObject({
      id: 'graph',
      agent: { name: 'LangGraph' },
    });
    // The chat reparents from the skipped seq up to the graph.
    expect(events.find((e) => e.type === 'chat.start')).toMatchObject({
      id: 'llm',
      parentId: 'graph',
    });
  });

  it('derives the provider from the serialized id path', () => {
    const { events, handler } = collect();
    handler.handleChatModelStart(
      { id: ['langchain', 'chat_models', 'ollama', 'ChatOllama'] },
      [],
      'l',
      undefined, // parentRunId — root run
      { invocation_params: { model: 'llama3.2' } },
    );
    expect(events[0]).toMatchObject({
      request: { provider: 'ollama', model: 'llama3.2' },
    });
  });
});
