import { describe, expect, it } from 'vitest';
import { observeAiSdkResult, type AiSdkResult } from './ai-sdk.js';
import type { GenAiObserverEvent } from './types.js';

function collect() {
  const events: GenAiObserverEvent[] = [];
  const observe = (event: GenAiObserverEvent) => events.push(event);
  return { events, observe };
}

const types = (events: GenAiObserverEvent[]) => events.map((e) => e.type);

describe('observeAiSdkResult', () => {
  it('emits a single chat for a trivial, tool-free generation', () => {
    const { events, observe } = collect();
    const result: AiSdkResult = {
      finishReason: 'stop',
      response: { modelId: 'gpt-4o', id: 'resp-1' },
      usage: { inputTokens: 1000, outputTokens: 500 },
    };

    observeAiSdkResult(observe, result, {
      id: 'gen-1',
      provider: 'openai.chat',
      model: 'gpt-4o',
    });

    expect(types(events)).toEqual(['chat.start', 'chat.end']);
    const start = events[0];
    const end = events[1];
    expect(start).toMatchObject({
      id: 'gen-1',
      request: { provider: 'openai', model: 'gpt-4o' },
    });
    expect(end).toMatchObject({
      id: 'gen-1',
      response: { model: 'gpt-4o', id: 'resp-1', finishReasons: ['stop'] },
      usage: { inputTokens: 1000, outputTokens: 500 },
      costModel: 'gpt-4o',
    });
  });

  it('maps legacy v4 usage field names', () => {
    const { events, observe } = collect();
    observeAiSdkResult(
      observe,
      { usage: { promptTokens: 10, completionTokens: 20 } },
      { id: 'g', model: 'gpt-4o' },
    );
    expect(events[1]).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it('wraps multi-step / tool-using calls in an agent with chat + tool children', () => {
    const { events, observe } = collect();
    const result: AiSdkResult = {
      steps: [
        {
          finishReason: 'tool-calls',
          response: { modelId: 'gpt-4o' },
          usage: { inputTokens: 100, outputTokens: 40 },
          toolCalls: [
            { toolCallId: 'call-1', toolName: 'search', input: { q: 'otel' } },
          ],
          toolResults: [{ toolCallId: 'call-1', output: { hits: 3 } }],
        },
        {
          finishReason: 'stop',
          response: { modelId: 'gpt-4o' },
          usage: { inputTokens: 150, outputTokens: 60 },
        },
      ],
    };

    observeAiSdkResult(observe, result, {
      id: 'run',
      provider: 'openai',
      model: 'gpt-4o',
    });

    expect(types(events)).toEqual([
      'agent.start',
      'chat.start',
      'chat.end',
      'tool.start',
      'tool.end',
      'chat.start',
      'chat.end',
      'agent.end',
    ]);

    // The wrapper agent is the parent of both the chats and the tool.
    expect(events[0]).toMatchObject({ type: 'agent.start', id: 'run' });
    expect(events[1]).toMatchObject({
      id: 'run:step:0',
      parentId: 'run',
    });
    expect(events[3]).toMatchObject({
      type: 'tool.start',
      id: 'run:tool:call-1',
      parentId: 'run',
      tool: { name: 'search', callId: 'call-1' },
      callArguments: { q: 'otel' },
    });
    expect(events[4]).toMatchObject({
      type: 'tool.end',
      callResult: { hits: 3 },
    });
    expect(events[5]).toMatchObject({ id: 'run:step:1', parentId: 'run' });
  });

  it('matches tool results positionally when call ids are absent', () => {
    const { events, observe } = collect();
    observeAiSdkResult(
      observe,
      {
        steps: [
          {
            toolCalls: [{ toolName: 'a', input: 1 }],
            toolResults: [{ result: 'ok' }],
          },
        ],
      },
      { id: 'r' },
    );
    const toolEnd = events.find((e) => e.type === 'tool.end');
    expect(toolEnd).toMatchObject({ callResult: 'ok' });
  });
});
