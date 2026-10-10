import type { SpanData, TraceData } from '../types';
import type { ToolResult } from './host';

type TagValue = string | number | boolean;

/** One span as autotel-mcp's `get_trace` returns it. */
export interface McpSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  startTimeUnixMs: number;
  durationMs: number;
  statusCode: 'OK' | 'ERROR' | 'UNSET';
  tags: Record<string, TagValue>;
  hasError: boolean;
}

/** `get_trace`'s payload: shared attributes hoisted into `resource`. */
export interface McpTrace {
  traceId: string;
  resource: Record<string, TagValue>;
  spanCount: number;
  spans: McpSpan[];
}

const KINDS = new Set<SpanData['kind']>([
  'INTERNAL',
  'SERVER',
  'CLIENT',
  'PRODUCER',
  'CONSUMER',
]);

function spanKind(attributes: Record<string, TagValue>): SpanData['kind'] {
  const raw = String(attributes['span.kind'] ?? '').toUpperCase();
  return KINDS.has(raw as SpanData['kind'])
    ? (raw as SpanData['kind'])
    : 'INTERNAL';
}

function toSpan(span: McpSpan, resource: McpTrace['resource']): SpanData {
  // get_trace hoists values every span shares into `resource`, so read
  // everything from the merged set, never from `tags` alone.
  const attributes: Record<string, TagValue> = {
    ...resource,
    ...span.tags,
    'service.name': span.serviceName,
  };
  const failed = span.hasError || span.statusCode === 'ERROR';
  const message =
    attributes['exception.message'] ?? attributes['error.message'];
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.operationName,
    kind: spanKind(attributes),
    startTime: span.startTimeUnixMs,
    endTime: span.startTimeUnixMs + span.durationMs,
    duration: span.durationMs,
    attributes,
    status: {
      code: failed ? 'ERROR' : span.statusCode,
      ...(failed && message !== undefined ? { message: String(message) } : {}),
    },
  };
}

export function toTraceData(trace: McpTrace): TraceData | null {
  const spans = trace.spans
    .map((span) => toSpan(span, trace.resource))
    .sort((a, b) => a.startTime - b.startTime);
  if (spans.length === 0) return null;
  const ids = new Set(spans.map((s) => s.spanId));
  const roots = spans.filter((s) => !s.parentSpanId);
  const rootSpan =
    roots[0] ??
    spans.find((s) => !s.parentSpanId || !ids.has(s.parentSpanId)) ??
    spans[0];
  const startTime = spans[0].startTime;
  const endTime = spans.reduce((end, s) => Math.max(end, s.endTime), 0);
  return {
    traceId: trace.traceId,
    correlationId: trace.traceId,
    rootSpan,
    spans,
    startTime,
    endTime,
    duration: endTime - startTime,
    status: spans.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK',
    service: String(
      rootSpan.attributes['service.name'] ?? trace.resource['service.name'],
    ),
    ...(roots.length === 0 ? { partial: true } : {}),
  };
}

function isMcpTrace(value: unknown): value is McpTrace {
  const v = value as Partial<McpTrace> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.traceId === 'string' &&
    Array.isArray(v.spans)
  );
}

/**
 * The trace inside a `get_trace` result: `structuredContent` when the host
 * passes it, else the JSON envelope (`{ ok, data }`) in the text content.
 * `undefined` for an error result or a trace the backend did not find.
 */
export function traceFromToolResult(result: ToolResult): McpTrace | undefined {
  if (result.isError) return undefined;
  const candidates: unknown[] = [result.structuredContent];
  for (const part of result.content ?? []) {
    if (part.type !== 'text' || !part.text) continue;
    try {
      candidates.push(JSON.parse(part.text));
    } catch {
      // Not JSON: nothing to draw from this part.
    }
  }
  for (const candidate of candidates) {
    if (isMcpTrace(candidate)) return candidate;
    const data = (candidate as { data?: unknown } | null)?.data;
    if (isMcpTrace(data)) return data;
  }
  return undefined;
}
