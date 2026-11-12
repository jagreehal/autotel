import { describe, expect, it } from 'vitest';
import { buildLanes, laneFor } from './timelineLanes';
import { toGenAiSpan } from './normalize';
import type { SpanData } from '../types';

const span = (
  spanId: string,
  name: string,
  startTime: number,
  endTime: number,
  attributes: SpanData['attributes'],
  links: { parentSpanId?: string; traceId?: string } = {},
) =>
  toGenAiSpan({
    traceId: links.traceId ?? 't',
    ...(links.parentSpanId ? { parentSpanId: links.parentSpanId } : {}),
    spanId,
    name,
    kind: 'INTERNAL',
    startTime,
    endTime,
    duration: endTime - startTime,
    attributes,
    status: { code: 'OK' },
  });

const chrome = {
  'gen_ai.provider.name': 'google.chrome',
  'builtin_ai.api': 'LanguageModel',
};

// A Chrome built-in AI tool exchange, as autotel-builtin-ai emits it: the
// root starts at the same instant as its first turn and ends with its last.
const exchange = [
  span('agent', 'invoke_agent LanguageModel', 0, 559, {
    ...chrome,
    'gen_ai.operation.name': 'invoke_agent',
  }),
  span('turn1', 'prompt LanguageModel', 0, 342, {
    ...chrome,
    'gen_ai.operation.name': 'generate_content',
  }),
  span('tool', 'execute_tool get_weather', 342, 370, {
    ...chrome,
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': 'get_weather',
  }),
  span('turn2', 'prompt LanguageModel', 370, 559, {
    ...chrome,
    'gen_ai.operation.name': 'generate_content',
  }),
];

describe('laneFor', () => {
  it('titles a tool run by its tool, not by a model it does not have', () => {
    expect(laneFor(exchange[2]!)).toBe('tool: get_weather');
  });

  it('titles a model call by provider and model', () => {
    expect(laneFor(exchange[1]!)).toBe('google.chrome/LanguageModel');
  });
});

describe('buildLanes', () => {
  // On one row the exchange and its first turn drew their labels on top of
  // each other, since both start at 0.
  it('moves a wrapper to its own row above what it wraps', () => {
    const lanes = buildLanes(exchange, 0, 559);
    expect(lanes.laneOrder).toEqual([
      'invoke_agent · google.chrome/LanguageModel',
      'google.chrome/LanguageModel',
      'tool: get_weather',
    ]);
    expect(
      lanes.laneMap
        .get('invoke_agent · google.chrome/LanguageModel')!
        .map((s) => s.spanId),
    ).toEqual(['agent']);
    expect(
      lanes.laneMap.get('google.chrome/LanguageModel')!.map((s) => s.spanId),
    ).toEqual(['turn1', 'turn2']);
    // Nothing left on any row wraps anything else.
    for (const ids of lanes.wrapperIdsByLane.values()) expect(ids.size).toBe(0);
  });

  it('leaves a row with no wrapper as it was', () => {
    const lanes = buildLanes([exchange[1]!, exchange[3]!], 0, 559);
    expect(lanes.laneOrder).toEqual(['google.chrome/LanguageModel']);
  });

  // A session with tools that answers without calling one: the exchange and
  // its only turn share their timestamps exactly, so no time test can say
  // which holds which. The parent link can.
  it('separates a single-turn exchange by its parent link', () => {
    const agent = span('agent', 'invoke_agent LanguageModel', 0, 300, {
      ...chrome,
      'gen_ai.operation.name': 'invoke_agent',
    });
    const turn = span(
      'turn',
      'prompt LanguageModel',
      0,
      300,
      { ...chrome, 'gen_ai.operation.name': 'generate_content' },
      { parentSpanId: 'agent' },
    );
    const lanes = buildLanes([agent, turn], 0, 300);
    expect(lanes.laneOrder).toEqual([
      'invoke_agent · google.chrome/LanguageModel',
      'google.chrome/LanguageModel',
    ]);
  });

  // A conversation row holds several traces, and a span id is unique only
  // within its own: a turn in one trace must not make an unrelated span with
  // the same id in another trace a wrapper.
  it('does not take a parent from another trace', () => {
    const elsewhere = span(
      'agent',
      'prompt LanguageModel',
      0,
      300,
      { ...chrome, 'gen_ai.operation.name': 'generate_content' },
      { traceId: 'other' },
    );
    const turn = span(
      'turn',
      'prompt LanguageModel',
      400,
      700,
      { ...chrome, 'gen_ai.operation.name': 'generate_content' },
      { parentSpanId: 'agent' },
    );
    const lanes = buildLanes([elsewhere, turn], 0, 700);
    expect(lanes.laneOrder).toEqual(['google.chrome/LanguageModel']);
  });
});
