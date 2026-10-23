// Build a depth-indented "trace" of one agent run: each model call decomposed
// into the parts that happened inside it (reasoning, the tools it called, the
// text it wrote) with nested sub-agents underneath. Built from our real span
// tree (parentSpanId + GenAI semantics) rather than synthetic timing.
//
// Two run shapes both fall out of the same builder:
//   - A tool has its own `execute_tool` span (a sibling of the chats): the
//     chats are leaf steps and the tool is shown from its own span.
//   - A framework emits an outer wrapper span (e.g. `ai.generateText`) over
//     child model calls, with the tool call inlined on a step rather than as a
//     separate span — so it is synthesized as a child of that step.

import { MODEL_OPS, AGENT_OPS } from './operations';
import { unwrapMcpToolResult } from './normalize';
import type { GenAiSpan } from './types';

export type TraceKind =
  | 'group' // a model call that wraps child model calls (an outer generate span)
  | 'agent' // invoke_agent / create_agent
  | 'step' // a leaf model call
  | 'reasoning'
  | 'tool'
  | 'text'
  | 'handoff'
  // A parent span that has not arrived while its children have: OTel exports a
  // span when it ends, so the parent is most likely still running.
  | 'running';

export interface TraceNode {
  id: string;
  kind: TraceKind;
  label: string;
  sublabel?: string;
  depth: number;
  startMs?: number;
  durationMs?: number;
  tokens?: { input?: number; output?: number };
  /** Priced cost in USD: the span's own for a model call, the sum of its
   *  children's for a container. Absent when nothing beneath it was priced. */
  costUsd?: number;
  error?: boolean;
  /** The originating GenAI span, when the node maps to one (for selection). */
  spanId?: string;
  traceId?: string;
  children: TraceNode[];
}

function truncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function preview(value: unknown, max = 60): string {
  if (value == null) return '';
  if (typeof value === 'string') return truncate(value, max);
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return truncate(String(value), max);
  }
}

function modelLabel(span: GenAiSpan): string {
  const model = span.responseModel ?? span.requestModel;
  if (model && model !== 'unknown') {
    return span.provider && span.provider !== 'unknown'
      ? `${span.provider}/${model}`
      : model;
  }
  return span.agent?.name ?? span.provider ?? 'model';
}

function costOf(span: GenAiSpan): number | undefined {
  return span.cost && span.cost.source !== 'unknown'
    ? span.cost.total
    : undefined;
}

/** A container's cost is what its children cost: an aggregate span's own cost
 *  duplicates theirs, and agent/tool spans carry none. */
function rollupCost(children: TraceNode[]): number | undefined {
  let total: number | undefined;
  for (const c of children)
    if (c.costUsd != null) total = (total ?? 0) + c.costUsd;
  return total;
}

/**
 * Parent span ids that children point at but that have not arrived. A span is
 * exported when it ends, so these are parents still running, or parents that
 * will never come (sampled out, or in a process that does not export here).
 * The caller tells the two apart by recency.
 */
export function missingParentIds(
  spans: ReadonlyArray<{ spanId: string; parentSpanId?: string }>,
): Set<string> {
  const ids = new Set(spans.map((s) => s.spanId));
  const missing = new Set<string>();
  for (const s of spans)
    if (s.parentSpanId && !ids.has(s.parentSpanId)) missing.add(s.parentSpanId);
  return missing;
}

function tokensOf(span: GenAiSpan): TraceNode['tokens'] | undefined {
  const { inputTokens, outputTokens } = span.usage;
  if (inputTokens == null && outputTokens == null) return undefined;
  return { input: inputTokens, output: outputTokens };
}

/** The last assistant text on a span — the answer it wrote, if any. */
function answerText(span: GenAiSpan): string | undefined {
  for (let i = span.messages.length - 1; i >= 0; i--) {
    const m = span.messages[i];
    if (m.role !== 'assistant') continue;
    const text = m.parts
      .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
      .map((p) => p.text)
      .join(' ')
      .trim();
    if (text) return text;
  }
  return undefined;
}

/** Result of an `execute_tool` span: `gen_ai.tool.call.result`, or Logfire's `tool_response`. */
function executeToolResult(span: GenAiSpan): string {
  const raw = span.extras?.raw ?? {};
  const result =
    span.tool?.result ?? raw['tool_response'] ?? raw['tool_result'];
  return result == null ? '' : preview(unwrapMcpToolResult(result));
}

export interface BuildRunTraceOptions {
  /** Parents believed still running (see `missingParentIds`). Roots under one
   *  are grouped beneath a `running` node standing in for it. */
  runningParentIds?: ReadonlySet<string>;
}

export function buildRunTrace(
  spans: GenAiSpan[],
  options: BuildRunTraceOptions = {},
): TraceNode[] {
  if (spans.length === 0) return [];

  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const childrenOf = new Map<string, GenAiSpan[]>();
  const roots: GenAiSpan[] = [];
  for (const s of spans) {
    const parent = s.parentSpanId;
    if (parent && byId.has(parent)) {
      const arr = childrenOf.get(parent) ?? [];
      arr.push(s);
      childrenOf.set(parent, arr);
    } else {
      roots.push(s);
    }
  }

  // Tool calls that already have a dedicated execute_tool span — don't also
  // synthesize them under the model call that requested them.
  const executedToolCallIds = new Set<string>();
  for (const s of spans) {
    if (s.operation === 'execute_tool' && s.tool?.callId)
      executedToolCallIds.add(s.tool.callId);
  }
  // A synthesized tool node is emitted once per call id, on the first (earliest)
  // step that references it — some frameworks replay prior tool calls in each
  // turn's history, so the same call otherwise shows up under every later step.
  const synthesizedToolCallIds = new Set<string>();

  const byStart = (a: GenAiSpan, b: GenAiSpan): number =>
    a.startMs - b.startMs || a.endMs - b.endMs;

  // Ids are stable across rebuilds, so a run that grows while it is watched
  // keeps its rows' collapse state and does not replay their entrance.
  const spanNid = (span: GenAiSpan): string => `${span.traceId}:${span.spanId}`;

  function childNodes(span: GenAiSpan, depth: number): TraceNode[] {
    return (childrenOf.get(span.spanId) ?? [])
      .sort(byStart)
      .map((c) => build(c, depth));
  }

  function build(span: GenAiSpan, depth: number): TraceNode {
    const op = span.operation;
    const durationMs = span.endMs - span.startMs;
    const base = {
      startMs: span.startMs,
      durationMs,
      spanId: span.spanId,
      traceId: span.traceId,
      error: span.status === 'error' || undefined,
    };
    const id = spanNid(span);

    if (op === 'execute_handoff' || span.handoff) {
      const from = span.handoff?.fromAgent ?? '?';
      const to = span.handoff?.toAgent ?? '?';
      const children = childNodes(span, depth + 1);
      return {
        id,
        kind: 'handoff',
        label: `${from} → ${to}`,
        depth,
        ...base,
        costUsd: rollupCost(children),
        children,
      };
    }

    if (AGENT_OPS.has(op)) {
      const children = childNodes(span, depth + 1);
      return {
        id,
        kind: 'agent',
        label: `Agent: ${span.agent?.name ?? 'agent'}`,
        sublabel: span.responseModel ?? span.requestModel,
        depth,
        ...base,
        tokens: tokensOf(span),
        costUsd: rollupCost(children),
        children,
      };
    }

    if (op === 'execute_tool') {
      const name = span.tool?.name ?? span.agent?.name ?? span.name ?? 'tool';
      const result = executeToolResult(span);
      const children = childNodes(span, depth + 1);
      return {
        id,
        kind: 'tool',
        label: `Tool: ${name}`,
        sublabel: result ? `→ ${result}` : undefined,
        depth,
        ...base,
        costUsd: rollupCost(children),
        children,
      };
    }

    if (MODEL_OPS.has(op)) {
      const kids = childNodes(span, depth + 1);
      // A model call that wraps child model calls (an outer generate span) is
      // an aggregate — its children carry the real content, so render it as a
      // plain container without re-synthesizing its (duplicated) parts.
      if (kids.length > 0) {
        return {
          id,
          kind: 'group',
          label: modelLabel(span),
          depth,
          ...base,
          tokens: tokensOf(span),
          costUsd: rollupCost(kids) ?? costOf(span),
          children: kids,
        };
      }

      const content: TraceNode[] = [];
      const reasoning = span.usage.reasoningOutputTokens ?? 0;
      if (reasoning > 0) {
        content.push({
          id: `${id}:reasoning`,
          kind: 'reasoning',
          label: 'Reasoning',
          sublabel: `${reasoning} tokens`,
          depth: depth + 1,
          children: [],
        });
      }
      for (const [i, tc] of span.toolCalls.entries()) {
        if (tc.id && executedToolCallIds.has(tc.id)) continue;
        if (tc.id && synthesizedToolCallIds.has(tc.id)) continue;
        if (tc.id) synthesizedToolCallIds.add(tc.id);
        const args = preview(tc.arguments, 40);
        const res =
          tc.result !== undefined ? ` → ${preview(tc.result, 40)}` : '';
        content.push({
          id: `${id}:tool:${tc.id ?? i}`,
          kind: 'tool',
          label: `Tool: ${tc.name}`,
          sublabel: `${args}${res}`.trim() || undefined,
          depth: depth + 1,
          children: [],
        });
      }
      const text = answerText(span);
      if (text) {
        content.push({
          id: `${id}:text`,
          kind: 'text',
          label: 'Text',
          sublabel: truncate(text),
          depth: depth + 1,
          children: [],
        });
      }
      return {
        id,
        kind: 'step',
        label: modelLabel(span),
        sublabel: span.operation,
        depth,
        ...base,
        tokens: tokensOf(span),
        costUsd: costOf(span),
        children: content,
      };
    }

    const children = childNodes(span, depth + 1);
    return {
      id,
      kind: 'step',
      label: span.name || op,
      depth,
      ...base,
      costUsd: rollupCost(children),
      children,
    };
  }

  roots.sort(byStart);
  const running = options.runningParentIds;
  if (!running?.size) return roots.map((r) => build(r, 0));

  // Roots whose parent is still running are drawn beneath a stand-in for it,
  // in the place the parent will take when it arrives. Its start is its
  // earliest child's: the parent began no later than that.
  const out: TraceNode[] = [];
  const standIns = new Map<string, TraceNode>();
  for (const root of roots) {
    const parentId = root.parentSpanId;
    if (!parentId || !running.has(parentId)) {
      out.push(build(root, 0));
      continue;
    }
    let standIn = standIns.get(parentId);
    if (!standIn) {
      standIn = {
        id: `${root.traceId}:${parentId}`,
        kind: 'running',
        label: 'Running',
        sublabel: 'parent span not received yet',
        depth: 0,
        startMs: root.startMs,
        traceId: root.traceId,
        children: [],
      };
      standIns.set(parentId, standIn);
      out.push(standIn);
    }
    standIn.children.push(build(root, 1));
  }
  for (const standIn of standIns.values()) {
    standIn.costUsd = rollupCost(standIn.children);
    standIn.error = standIn.children.some((c) => c.error) || undefined;
  }
  return out;
}

/** Flatten the trace tree to a depth-ordered list for rendering. */
export function flattenTrace(nodes: TraceNode[]): TraceNode[] {
  const out: TraceNode[] = [];
  const walk = (n: TraceNode): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
}
