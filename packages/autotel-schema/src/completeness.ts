/**
 * GenAI trace completeness — does a trace tell the whole agent story?
 *
 * Where {@link ./contract} declares the *surface* of your telemetry and
 * {@link ./scenario} the *behaviour* of one flow, this scores the *fidelity* of
 * a GenAI trace: can a reader reconstruct what the model was asked, what it
 * answered, what it cost, which tools it called with which arguments, and how
 * the spans nest? Those are the fields root-cause analysis needs, and the ones
 * agent-observability platforms are themselves benchmarked on — a trace that
 * loses them is unanalysable no matter which backend it lands in.
 *
 * Ten fields, one point each, half a point when a field is present but partial
 * (token usage with only one direction, tool calls whose results never landed).
 *
 * Dependency-free like the rest of the package: usable from vitest, the CLI, or
 * a browser panel. Input is {@link ScenarioSpan}, so a `test-span-collector`
 * trace feeds straight in.
 *
 * @example
 * ```ts
 * const result = scoreGenAiCompleteness(collector.peekTrace(traceId));
 * if (result.score < 8) throw new Error(formatCompleteness(result));
 * ```
 */

import type { ScenarioSpan } from './scenario.js';

/** The ten fields a GenAI trace is scored on. */
export const GENAI_COMPLETENESS_FIELDS = [
  'llm_input',
  'llm_output',
  'model_name',
  'token_usage',
  'cost_usd',
  'latency_per_span',
  'tool_call_args',
  'tool_call_results',
  'span_tree',
  'span_count',
] as const;

export type GenAiCompletenessField = (typeof GENAI_COMPLETENESS_FIELDS)[number];

/** Per-field outcome: 1 present, 0.5 partial, 0 absent. */
export interface FieldScore {
  field: GenAiCompletenessField;
  points: 0 | 0.5 | 1;
  /** Why the field scored what it did — shown to whoever has to fix it. */
  detail: string;
}

export interface CompletenessResult {
  /** Total points, 0–10. */
  score: number;
  max: number;
  fields: FieldScore[];
  /** Fields that scored 0. */
  missing: GenAiCompletenessField[];
  /** Fields that scored 0.5. */
  partial: GenAiCompletenessField[];
}

/** A value counts as present only if it is non-null and not an empty string/array. */
function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function anySpanHas(spans: ScenarioSpan[], key: string): boolean {
  return spans.some((s) => isNonEmpty(s.attributes?.[key]));
}

function countSpansWith(spans: ScenarioSpan[], key: string): number {
  return spans.filter((s) => isNonEmpty(s.attributes?.[key])).length;
}

function score(
  field: GenAiCompletenessField,
  points: 0 | 0.5 | 1,
  detail: string,
): FieldScore {
  return { field, points, detail };
}

/**
 * Score a single trace's spans against the ten-field checklist.
 *
 * Pass every span of one trace — the tree and count checks are meaningless on a
 * partial slice.
 */
export function scoreGenAiCompleteness(
  spans: ScenarioSpan[],
): CompletenessResult {
  const fields: FieldScore[] = [];

  fields.push(
    anySpanHas(spans, 'gen_ai.input.messages')
      ? score('llm_input', 1, 'gen_ai.input.messages present')
      : score('llm_input', 0, 'no span carries gen_ai.input.messages'),
  );

  fields.push(
    anySpanHas(spans, 'gen_ai.output.messages')
      ? score('llm_output', 1, 'gen_ai.output.messages present')
      : score('llm_output', 0, 'no span carries gen_ai.output.messages'),
  );

  const hasResponseModel = anySpanHas(spans, 'gen_ai.response.model');
  const hasRequestModel = anySpanHas(spans, 'gen_ai.request.model');
  fields.push(
    hasResponseModel || hasRequestModel
      ? score(
          'model_name',
          1,
          hasResponseModel
            ? 'gen_ai.response.model present'
            : 'gen_ai.request.model present (no response model)',
        )
      : score('model_name', 0, 'neither request nor response model recorded'),
  );

  const hasInputTokens = anySpanHas(spans, 'gen_ai.usage.input_tokens');
  const hasOutputTokens = anySpanHas(spans, 'gen_ai.usage.output_tokens');
  if (hasInputTokens && hasOutputTokens) {
    fields.push(score('token_usage', 1, 'input and output tokens recorded'));
  } else if (hasInputTokens || hasOutputTokens) {
    fields.push(
      score(
        'token_usage',
        0.5,
        `only ${hasInputTokens ? 'input' : 'output'} tokens recorded`,
      ),
    );
  } else {
    fields.push(score('token_usage', 0, 'no token usage recorded'));
  }

  fields.push(
    anySpanHas(spans, 'gen_ai.usage.cost.usd')
      ? score('cost_usd', 1, 'gen_ai.usage.cost.usd present')
      : score('cost_usd', 0, 'no span carries gen_ai.usage.cost.usd'),
  );

  const timed = spans.filter(
    (s) => typeof s.durationMs === 'number' && s.durationMs >= 0,
  ).length;
  if (spans.length > 0 && timed === spans.length) {
    fields.push(score('latency_per_span', 1, `all ${timed} spans timed`));
  } else if (timed > 0) {
    fields.push(
      score(
        'latency_per_span',
        0.5,
        `${timed} of ${spans.length} spans carry a duration`,
      ),
    );
  } else {
    fields.push(score('latency_per_span', 0, 'no span carries a duration'));
  }

  const argCount = countSpansWith(spans, 'gen_ai.tool.call.arguments');
  const resultCount = countSpansWith(spans, 'gen_ai.tool.call.result');
  const toolSpans = countSpansWith(spans, 'gen_ai.tool.name');

  fields.push(
    argCount > 0
      ? score('tool_call_args', 1, `${argCount} tool call(s) carry arguments`)
      : score(
          'tool_call_args',
          0,
          toolSpans > 0
            ? `${toolSpans} tool span(s) but none carry gen_ai.tool.call.arguments`
            : 'no tool calls in this trace',
        ),
  );

  if (resultCount > 0 && resultCount >= argCount) {
    fields.push(
      score(
        'tool_call_results',
        1,
        `${resultCount} tool call(s) carry results`,
      ),
    );
  } else if (resultCount > 0) {
    fields.push(
      score(
        'tool_call_results',
        0.5,
        `${resultCount} of ${argCount} tool call(s) carry a result`,
      ),
    );
  } else {
    fields.push(
      score(
        'tool_call_results',
        0,
        toolSpans > 0
          ? `${toolSpans} tool span(s) but none carry gen_ai.tool.call.result`
          : 'no tool calls in this trace',
      ),
    );
  }

  // A tree needs a child whose parent is actually in the set — a dangling
  // parent id proves nothing was linked, it just points off into the dark.
  const ids = new Set(spans.map((s) => s.spanId));
  const linked = spans.filter(
    (s) => s.parentSpanId !== undefined && ids.has(s.parentSpanId),
  ).length;
  const dangling = spans.filter(
    (s) => s.parentSpanId !== undefined && !ids.has(s.parentSpanId),
  ).length;
  if (linked > 0) {
    fields.push(
      score('span_tree', 1, `${linked} parent/child link(s) resolve`),
    );
  } else if (dangling > 0) {
    fields.push(
      score('span_tree', 0.5, `${dangling} parent id(s) resolve to no span`),
    );
  } else {
    fields.push(score('span_tree', 0, 'trace is flat — no parent/child links'));
  }

  // A single span can't show an agent doing anything; two is the floor for a
  // model call plus one step around it.
  if (spans.length >= 2) {
    fields.push(score('span_count', 1, `${spans.length} spans`));
  } else if (spans.length === 1) {
    fields.push(score('span_count', 0.5, 'single-span trace'));
  } else {
    fields.push(score('span_count', 0, 'no spans'));
  }

  return {
    score: fields.reduce((sum, f) => sum + f.points, 0),
    max: GENAI_COMPLETENESS_FIELDS.length,
    fields,
    missing: fields.filter((f) => f.points === 0).map((f) => f.field),
    partial: fields.filter((f) => f.points === 0.5).map((f) => f.field),
  };
}

/** One line per field, for a CLI or a failed assertion. */
export function formatCompleteness(result: CompletenessResult): string {
  const header = `GenAI trace completeness: ${result.score}/${result.max}`;
  const lines = result.fields.map((f) => {
    const mark = f.points === 1 ? '✓' : f.points === 0.5 ? '~' : '✗';
    return `  ${mark} ${f.field} — ${f.detail}`;
  });
  return [header, ...lines].join('\n');
}
