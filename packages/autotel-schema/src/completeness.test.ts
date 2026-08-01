import { describe, expect, it } from 'vitest';
import {
  GENAI_COMPLETENESS_FIELDS,
  scoreGenAiCompleteness,
} from './completeness.js';
import type { ScenarioSpan } from './scenario.js';

/**
 * A two-span agent trace carrying every field the checklist asks for, using the
 * `gen_ai.*` keys autotel-genai emits. Mirrors the shape a read API returned for
 * a Pydantic AI tools trace that scored a full 10/10 on the same checklist.
 */
const completeTrace: ScenarioSpan[] = [
  {
    spanId: 'a1b2c3d4e5f60718',
    name: 'chat claude-opus-5',
    status: 'ok',
    durationMs: 1250,
    attributes: {
      'gen_ai.input.messages':
        '[{"role":"user","content":"weather in Lisbon?"}]',
      'gen_ai.output.messages':
        '[{"role":"assistant","content":"29C and sunny"}]',
      'gen_ai.request.model': 'claude-opus-5',
      'gen_ai.response.model': 'claude-opus-5',
      'gen_ai.usage.input_tokens': 981,
      'gen_ai.usage.output_tokens': 183,
      'gen_ai.usage.cost.usd': 0.005688,
    },
  },
  {
    spanId: '00112233445566aa',
    parentSpanId: 'a1b2c3d4e5f60718',
    name: 'execute_tool get_weather',
    status: 'ok',
    durationMs: 500,
    attributes: {
      'gen_ai.tool.name': 'get_weather',
      'gen_ai.tool.call.arguments': '{"city":"Lisbon"}',
      'gen_ai.tool.call.result': '{"tempC":29}',
    },
  },
];

describe('scoreGenAiCompleteness', () => {
  it('gives a fully instrumented agent trace full marks', () => {
    const result = scoreGenAiCompleteness(completeTrace);
    expect(result.score).toBe(10);
    expect(result.max).toBe(10);
    expect(result.missing).toEqual([]);
  });

  it('docks a point per absent field and names what is gone', () => {
    const noCostOrToolResults = completeTrace.map((span) => ({
      ...span,
      attributes: Object.fromEntries(
        Object.entries(span.attributes ?? {}).filter(
          ([key]) =>
            key !== 'gen_ai.usage.cost.usd' &&
            key !== 'gen_ai.tool.call.result',
        ),
      ),
    }));
    const result = scoreGenAiCompleteness(noCostOrToolResults);
    expect(result.score).toBe(8.5);
    expect(result.missing).toEqual(['cost_usd']);
    expect(result.partial).toContain('tool_call_results');
  });

  it('gives half a point for token usage recorded in one direction only', () => {
    const inputTokensOnly = completeTrace.map((span) => ({
      ...span,
      attributes: Object.fromEntries(
        Object.entries(span.attributes ?? {}).filter(
          ([key]) => key !== 'gen_ai.usage.output_tokens',
        ),
      ),
    }));
    const result = scoreGenAiCompleteness(inputTokensOnly);
    expect(result.score).toBe(9.5);
    expect(result.partial).toEqual(['token_usage']);
  });

  it('does not credit a span tree when the parent id resolves to nothing', () => {
    const orphaned: ScenarioSpan[] = [
      { ...completeTrace[1], parentSpanId: 'ffffffffffffffff' },
      completeTrace[0],
    ];
    const result = scoreGenAiCompleteness(orphaned);
    expect(result.partial).toContain('span_tree');
  });

  it('scores an empty trace zero rather than throwing', () => {
    const result = scoreGenAiCompleteness([]);
    expect(result.score).toBe(0);
    expect(result.missing).toEqual(GENAI_COMPLETENESS_FIELDS.slice());
  });

  it('treats an empty-string attribute as absent, not present', () => {
    const blankOutput = completeTrace.map((span) => ({
      ...span,
      attributes: { ...span.attributes, 'gen_ai.output.messages': '' },
    }));
    expect(scoreGenAiCompleteness(blankOutput).missing).toContain('llm_output');
  });

  it('scores tool completeness per call instead of comparing aggregate counts', () => {
    const mixedTools: ScenarioSpan[] = [
      completeTrace[0],
      completeTrace[1],
      {
        spanId: 'second-tool',
        parentSpanId: completeTrace[0]!.spanId,
        name: 'execute_tool reserve_hotel',
        status: 'ok',
        durationMs: 10,
        attributes: {
          'gen_ai.tool.name': 'reserve_hotel',
          'gen_ai.tool.call.result': '{"ok":true}',
        },
      },
    ];

    const result = scoreGenAiCompleteness(mixedTools);
    expect(
      result.fields.find((field) => field.field === 'tool_call_args'),
    ).toMatchObject({
      points: 0.5,
    });
    expect(
      result.fields.find((field) => field.field === 'tool_call_results'),
    ).toMatchObject({ points: 1 });
  });
});
