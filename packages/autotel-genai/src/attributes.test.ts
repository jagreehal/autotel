import { describe, expect, it } from 'vitest';
import {
  genAiAgentAttributes,
  genAiMemoryAttributes,
  genAiRequestAttributes,
  genAiRetrievalAttributes,
  genAiResponseAttributes,
  genAiToolAttributes,
  genAiUsageAttributes,
  genAiWorkflowAttributes,
} from './attributes.js';

describe('genAiRequestAttributes', () => {
  it('maps camelCase inputs to canonical keys, omitting undefined', () => {
    expect(
      genAiRequestAttributes({
        operation: 'chat',
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0.2,
        maxTokens: 256,
        serverAddress: 'api.openai.com',
        serverPort: 443,
      }),
    ).toEqual({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-4o',
      'gen_ai.request.temperature': 0.2,
      'gen_ai.request.max_tokens': 256,
      'server.address': 'api.openai.com',
      'server.port': 443,
    });
  });

  it('truncates top_k to an integer (spec is int)', () => {
    expect(genAiRequestAttributes({ topK: 40.9 })).toEqual({
      'gen_ai.request.top_k': 40,
    });
  });

  it('drops empty arrays', () => {
    expect(genAiRequestAttributes({ stopSequences: [] })).toEqual({});
  });
});

describe('genAiResponseAttributes', () => {
  it('records finish reasons as an array', () => {
    expect(
      genAiResponseAttributes({ model: 'gpt-4o', finishReasons: ['stop'] }),
    ).toEqual({
      'gen_ai.response.model': 'gpt-4o',
      'gen_ai.response.finish_reasons': ['stop'],
    });
  });
});

describe('genAiUsageAttributes', () => {
  it('maps token + cost fields, never emitting total_tokens', () => {
    const attrs = genAiUsageAttributes({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 20,
      costUsd: 0.001,
    });
    expect(attrs).toEqual({
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 50,
      'gen_ai.usage.cache_read.input_tokens': 20,
      // Cost goes out under both names in use. Backends split on which one they
      // read (Langfuse takes `gen_ai.usage.cost`), and a cost that lands only
      // under the name yours does not know is a cost you cannot see.
      'gen_ai.usage.cost.usd': 0.001,
      'gen_ai.usage.cost': 0.001,
    });
    expect(Object.keys(attrs)).not.toContain('gen_ai.usage.total_tokens');
  });

  it('omits both cost attributes when the model has no pricing', () => {
    const attrs = genAiUsageAttributes({ inputTokens: 10, outputTokens: 5 });
    expect(Object.keys(attrs)).not.toContain('gen_ai.usage.cost');
    expect(Object.keys(attrs)).not.toContain('gen_ai.usage.cost.usd');
  });
});

describe('genAiAgentAttributes', () => {
  it('includes agent.id by default (create_agent / client invoke_agent)', () => {
    expect(genAiAgentAttributes({ id: 'agent-1', name: 'planner' })).toEqual({
      'gen_ai.agent.id': 'agent-1',
      'gen_ai.agent.name': 'planner',
    });
  });

  it('drops agent.id on internal spans (breaking change #242)', () => {
    expect(
      genAiAgentAttributes(
        { id: 'agent-1', name: 'planner' },
        { internal: true },
      ),
    ).toEqual({ 'gen_ai.agent.name': 'planner' });
  });
});

describe('genAiToolAttributes', () => {
  it('maps tool fields', () => {
    expect(
      genAiToolAttributes({
        name: 'get_weather',
        type: 'function',
        callId: 'c1',
        callArguments: { city: 'Paris' },
      }),
    ).toEqual({
      'gen_ai.tool.name': 'get_weather',
      'gen_ai.tool.type': 'function',
      'gen_ai.tool.call.id': 'c1',
      'gen_ai.tool.call.arguments': '{"city":"Paris"}',
    });
  });
});

describe('genAiRetrievalAttributes', () => {
  it('maps retrieval fields and truncates top_k', () => {
    expect(
      genAiRetrievalAttributes({ topK: 3.8, queryText: 'weather in paris' }),
    ).toEqual({
      'gen_ai.retrieval.top_k': 3,
      'gen_ai.retrieval.query.text': 'weather in paris',
    });
  });
});

describe('genAiMemoryAttributes', () => {
  it('maps memory fields', () => {
    expect(
      genAiMemoryAttributes({
        storeId: 'mem-store',
        recordCount: 2,
        records: [{ id: 'mem-1' }],
      }),
    ).toEqual({
      'gen_ai.memory.store.id': 'mem-store',
      'gen_ai.memory.record.count': 2,
      'gen_ai.memory.records': '[{"id":"mem-1"}]',
    });
  });
});

describe('genAiWorkflowAttributes', () => {
  it('maps workflow and prompt names', () => {
    expect(
      genAiWorkflowAttributes({
        workflowName: 'support_triage',
        promptName: 'initial-router',
      }),
    ).toEqual({
      'gen_ai.workflow.name': 'support_triage',
      'gen_ai.prompt.name': 'initial-router',
    });
  });

  it('identifies which version of the prompt ran', () => {
    expect(
      genAiWorkflowAttributes({
        promptName: 'initial-router',
        promptVersion: 7,
        promptLabel: 'production',
        promptHash: 'sha256:abc123',
      }),
    ).toEqual({
      'gen_ai.prompt.name': 'initial-router',
      'gen_ai.prompt.version': 7,
      'gen_ai.prompt.label': 'production',
      'gen_ai.prompt.hash': 'sha256:abc123',
    });
  });

  it('takes a string version for registries that do not number them', () => {
    expect(genAiWorkflowAttributes({ promptVersion: 'v2.1.0' })).toEqual({
      'gen_ai.prompt.version': 'v2.1.0',
    });
  });
});

describe('genAiUsageAttributes provenance', () => {
  it('labels where the token counts came from', () => {
    expect(
      genAiUsageAttributes({ inputTokens: 10, tokenSource: 'estimated' }),
    ).toEqual({
      'gen_ai.usage.input_tokens': 10,
      'autotel.evidence.tokens': 'estimated',
    });
  });

  it('names the server tools missing from the cost', () => {
    expect(
      genAiUsageAttributes({
        costUsd: 1,
        unpricedServerTools: ['mystery_tool'],
      }),
    ).toMatchObject({
      'gen_ai.usage.cost.unpriced_tools': ['mystery_tool'],
    });
  });

  it('says nothing when nothing is missing', () => {
    expect(genAiUsageAttributes({ inputTokens: 1 })).toEqual({
      'gen_ai.usage.input_tokens': 1,
    });
  });
});
