import type { TraceRecord } from '../types.js';

export interface TraceSummary {
  traceId: string;
  serviceName: string;
  durationMs: number;
  statusCode: 'OK' | 'ERROR' | 'UNSET';
  spanCount: number;
  llmSpanCount: number;
  errorSpanCount: number;
  totalTokens: number;
  modelsUsed: string[];
  serviceCount: number;
  topOperations: Array<{ operation: string; count: number }>;
}

function deriveServiceName(trace: TraceRecord): string {
  const rootSpan =
    trace.spans.find((span) => !span.parentSpanId) ?? trace.spans[0];
  return rootSpan?.serviceName ?? 'unknown';
}

function deriveDurationMs(trace: TraceRecord): number {
  if (trace.spans.length === 0) return 0;
  const start = Math.min(...trace.spans.map((s) => s.startTimeUnixMs));
  const end = Math.max(
    ...trace.spans.map((s) => s.startTimeUnixMs + s.durationMs),
  );
  return end - start;
}

function deriveStatusCode(trace: TraceRecord): 'OK' | 'ERROR' | 'UNSET' {
  if (trace.spans.some((s) => s.statusCode === 'ERROR')) return 'ERROR';
  if (trace.spans.some((s) => s.statusCode === 'OK')) return 'OK';
  return 'UNSET';
}

export function summarizeTrace(trace: TraceRecord): TraceSummary {
  const errors = trace.spans.filter((span) => span.hasError).length;
  const services = new Set(trace.spans.map((span) => span.serviceName));
  const operationCounts = new Map<string, number>();
  const models = new Set<string>();
  let totalTokens = 0;
  for (const span of trace.spans) {
    operationCounts.set(
      span.operationName,
      (operationCounts.get(span.operationName) ?? 0) + 1,
    );
    const model = getSpanModel(span);
    if (model) models.add(model);
    totalTokens += getSpanTokens(span);
  }

  return {
    traceId: trace.traceId,
    serviceName: deriveServiceName(trace),
    durationMs: deriveDurationMs(trace),
    statusCode: deriveStatusCode(trace),
    spanCount: trace.spans.length,
    llmSpanCount: trace.spans.filter(isLlmSpan).length,
    errorSpanCount: errors,
    totalTokens,
    modelsUsed: Array.from(models).sort(),
    serviceCount: services.size,
    topOperations: Array.from(operationCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([operation, count]) => ({ operation, count })),
  };
}

function isLlmSpan(span: TraceRecord['spans'][number]): boolean {
  return getSpanModel(span) !== undefined;
}

function getSpanModel(span: TraceRecord['spans'][number]): string | undefined {
  const response =
    span.tags['gen_ai.response.model'] ?? span.tags['llm.response.model'];
  if (typeof response === 'string') return response;
  const request =
    span.tags['gen_ai.request.model'] ?? span.tags['llm.request.model'];
  return typeof request === 'string' ? request : undefined;
}

function getSpanTokens(span: TraceRecord['spans'][number]): number {
  const total =
    span.tags['gen_ai.usage.total_tokens'] ??
    span.tags['llm.usage.total_tokens'] ??
    span.tags['gen_ai.usage.prompt_tokens'] ??
    span.tags['gen_ai.usage.input_tokens'] ??
    span.tags['llm.usage.prompt_tokens'] ??
    span.tags['llm.usage.input_tokens'];
  return typeof total === 'number' ? total : Number(total ?? 0) || 0;
}
