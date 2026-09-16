import { describe, it, expect } from 'vitest';
import { spanLabel } from './label';
import type { GenAiSpan } from './types';

function span(overrides: Partial<GenAiSpan> = {}): GenAiSpan {
  return {
    traceId: 't',
    spanId: 's',
    name: 'chat',
    startMs: 0,
    endMs: 1,
    status: 'ok',
    provider: 'unknown',
    operation: 'chat',
    requestModel: 'unknown',
    params: {},
    messages: [],
    toolCalls: [],
    usage: {},
    extras: { raw: {} },
    ...overrides,
  };
}

describe('spanLabel', () => {
  it('labels execute_tool spans by tool name instead of unknown/unknown', () => {
    expect(
      spanLabel(span({ operation: 'execute_tool', tool: { name: 'cities' } })),
    ).toEqual({ kind: 'tool', text: 'tool: cities' });
  });

  it('labels agent spans by agent name', () => {
    expect(
      spanLabel(span({ operation: 'invoke_agent', agent: { name: 'demo' } })),
    ).toEqual({ kind: 'agent', text: 'agent: demo' });
  });

  it('prefers provider/model when known', () => {
    expect(
      spanLabel(
        span({
          provider: 'aws.bedrock',
          requestModel: 'zai.glm-4.7-flash',
          tool: { name: 'cities' },
        }),
      ),
    ).toEqual({ kind: 'model', text: 'aws.bedrock/zai.glm-4.7-flash' });
  });
});
