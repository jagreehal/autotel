// GenAI story fixtures, built by running the real normalisers over the real
// recorded spans in `src/widget/genai/__fixtures__/`.
//
// Nothing here is hand-written: a hand-built `GenAiSpan` drifts from whatever
// `toGenAiSpan` actually produces, and then a story shows a shape the app
// cannot. Same reasoning as `__fixtures__/agents.ts`.

import type { SpanData } from '../../types';
import { toGenAiSpan } from '../../genai/normalize';
import { summarizeRun } from '../../genai/summary';
import { buildTour } from '../../genai/narration';
import { buildRunTrace } from '../../genai/trace';
import type { GenAiSpan, GenAiToolCall } from '../../genai/types';
import openaiChat from '../../genai/__fixtures__/openai-v2-chat.json';
import aisdkTools from '../../genai/__fixtures__/aisdk-ollama-tools-real.json';

// The recordings differ in shape: `openai-v2-chat.json` is a single span,
// `aisdk-ollama-tools-real.json` is the whole run. Normalise to arrays here so
// callers do not have to care.
const chatSpans = [openaiChat as unknown as SpanData];
const toolSpans = aisdkTools as unknown as SpanData[];

/** A plain chat completion — the simplest useful GenAI span. */
export function chatSpan(): GenAiSpan {
  return toGenAiSpan(chatSpans[0]);
}

/** Spans from a run that actually called tools. */
export function toolRunSpans(): GenAiSpan[] {
  return toolSpans.map(toGenAiSpan);
}

/** The first tool call the recorded run made, if it made one. */
export function firstToolCall(): GenAiToolCall | undefined {
  for (const span of toolRunSpans()) {
    const call = span.toolCalls?.[0];
    if (call) return call;
  }
  return undefined;
}

export function runSummary() {
  return summarizeRun(toolRunSpans());
}

export function tourSteps() {
  return buildTour(toolRunSpans());
}

export function runTraceNodes() {
  return buildRunTrace(toolRunSpans());
}

/** Shape `AgentTimeline` expects: normalised span plus its provenance. */
export function timelineRows() {
  return toolRunSpans().map((normalized, i) => ({
    normalized,
    service: 'ai-agent',
    traceId: toolSpans[i]?.traceId ?? 'trace-1',
  }));
}
