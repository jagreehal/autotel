import type { SpanRecord, TagValue, TraceRecord } from '../types';
import { estimateCostUsd, priceFor } from './llm-pricing';

export interface UsageReport {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  /**
   * Sum of priced requests only. Requests using a model absent from the
   * pricing catalog don't contribute; check `unpricedRequests` to spot
   * coverage gaps (typical cause: a new model name — add it to
   * AUTOTEL_LLM_PRICES_JSON).
   */
  totalCostUsd: number;
  unpricedRequests: number;
  byModel: Record<
    string,
    {
      requests: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
      /** `null` when the model isn't in the pricing catalog. */
      inputPricePerMtok: number | null;
      outputPricePerMtok: number | null;
    }
  >;
  byService: Record<
    string,
    {
      requests: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
    }
  >;
}

export interface LlmModelSummary {
  model: string;
  provider: string | undefined;
  requestCount: number;
  firstSeenUnixMs: number;
  lastSeenUnixMs: number;
}

export interface LlmModelStats {
  model: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  errorRate: number;
  durationMs: PercentileStats;
  tokens: {
    prompt: PercentileStats;
    completion: PercentileStats;
    total: PercentileStats;
  };
  /** Total USD spend across priced requests. Zero if model is unpriced. */
  costUsd: number;
  /** Published list prices per million tokens, or null if uncatalogued. */
  inputPricePerMtok: number | null;
  outputPricePerMtok: number | null;
  finishReasons: Record<string, number> | null;
}

export interface PercentileStats {
  mean: number;
  median: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface LlmToolUsage {
  toolName: string;
  usageCount: number;
  services: string[];
  firstSeenUnixMs: number;
  lastSeenUnixMs: number;
}

export interface ErrorSpanDetail {
  spanId: string;
  operationName: string;
  serviceName: string;
  status: string;
  errorMessage: string;
  errorType: string | undefined;
  stackTrace: string | undefined;
  isLlmError: boolean;
  llmProvider?: string | null;
  llmModel?: string | null;
}

export interface ErrorTraceDetail {
  traceId: string;
  serviceName: string;
  operationName: string;
  startTimeUnixMs: number;
  durationMs: number;
  status: string;
  spanCount: number;
  hasErrors: boolean;
  errorSpans: ErrorSpanDetail[];
}

export interface RankedTraceSummary {
  traceId: string;
  serviceName: string;
  operationName: string;
  startTimeUnixMs: number;
  durationMs: number;
  models: string[];
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Priced spans only — unpriced spans don't contribute. */
  costUsd: number;
  /** True if any LLM span in the trace couldn't be priced. */
  hasUnpricedSpans: boolean;
  status: string;
  hasErrors: boolean;
  llmSpanCount: number;
}

export function collectUsage(traces: TraceRecord[]): UsageReport {
  const report: UsageReport = {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    unpricedRequests: 0,
    byModel: {},
    byService: {},
  };

  for (const trace of traces) {
    for (const span of trace.spans) {
      const llm = getLlmSpan(span);
      if (!llm) continue;
      report.totalRequests += 1;
      report.totalPromptTokens += llm.promptTokens;
      report.totalCompletionTokens += llm.completionTokens;
      report.totalTokens += llm.totalTokens;

      const model = llm.model ?? 'unknown';
      const price = priceFor(llm.model);
      const cost =
        estimateCostUsd(llm.model, llm.promptTokens, llm.completionTokens) ??
        null;
      if (cost === null) {
        report.unpricedRequests += 1;
      } else {
        report.totalCostUsd += cost;
      }

      const modelBucket = report.byModel[model] ?? {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        inputPricePerMtok: price?.inputPerMtok ?? null,
        outputPricePerMtok: price?.outputPerMtok ?? null,
      };
      modelBucket.requests += 1;
      modelBucket.promptTokens += llm.promptTokens;
      modelBucket.completionTokens += llm.completionTokens;
      modelBucket.totalTokens += llm.totalTokens;
      if (cost !== null) modelBucket.costUsd += cost;
      report.byModel[model] = modelBucket;

      const service = span.serviceName;
      const serviceBucket = report.byService[service] ?? {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      };
      serviceBucket.requests += 1;
      serviceBucket.promptTokens += llm.promptTokens;
      serviceBucket.completionTokens += llm.completionTokens;
      serviceBucket.totalTokens += llm.totalTokens;
      if (cost !== null) serviceBucket.costUsd += cost;
      report.byService[service] = serviceBucket;
    }
  }

  return report;
}

export function listModels(traces: TraceRecord[]): LlmModelSummary[] {
  const models = new Map<string, LlmModelSummary>();

  for (const trace of traces) {
    for (const span of trace.spans) {
      const llm = getLlmSpan(span);
      if (!llm || !llm.model) continue;

      const existing = models.get(llm.model) ?? {
        model: llm.model,
        provider: llm.provider,
        requestCount: 0,
        firstSeenUnixMs: span.startTimeUnixMs,
        lastSeenUnixMs: span.startTimeUnixMs,
      };

      existing.requestCount += 1;
      existing.provider = existing.provider ?? llm.provider;
      existing.firstSeenUnixMs = Math.min(
        existing.firstSeenUnixMs,
        span.startTimeUnixMs,
      );
      existing.lastSeenUnixMs = Math.max(
        existing.lastSeenUnixMs,
        span.startTimeUnixMs,
      );
      models.set(llm.model, existing);
    }
  }

  return Array.from(models.values()).sort(
    (a, b) => b.requestCount - a.requestCount || a.model.localeCompare(b.model),
  );
}

export function getModelStats(
  traces: TraceRecord[],
  modelName: string,
): LlmModelStats | null {
  const durations: number[] = [];
  const promptTokens: number[] = [];
  const completionTokens: number[] = [];
  const totalTokens: number[] = [];
  const finishReasons = new Map<string, number>();
  let requestCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let costUsd = 0;

  for (const trace of traces) {
    for (const span of trace.spans) {
      const llm = getLlmSpan(span);
      if (!llm || llm.model !== modelName) continue;
      requestCount += 1;
      durations.push(span.durationMs);
      if (llm.promptTokens > 0) promptTokens.push(llm.promptTokens);
      if (llm.completionTokens > 0) completionTokens.push(llm.completionTokens);
      if (llm.totalTokens > 0) totalTokens.push(llm.totalTokens);
      const cost = estimateCostUsd(
        llm.model,
        llm.promptTokens,
        llm.completionTokens,
      );
      if (cost !== null) costUsd += cost;
      for (const reason of llm.finishReasons) {
        finishReasons.set(reason, (finishReasons.get(reason) ?? 0) + 1);
      }
      if (span.hasError) errorCount += 1;
      else successCount += 1;
    }
  }

  if (requestCount === 0) return null;

  const price = priceFor(modelName);
  return {
    model: modelName,
    requestCount,
    successCount,
    errorCount,
    successRate: round((successCount / requestCount) * 100),
    errorRate: round((errorCount / requestCount) * 100),
    durationMs: calculatePercentiles(durations),
    tokens: {
      prompt: calculatePercentiles(promptTokens),
      completion: calculatePercentiles(completionTokens),
      total: calculatePercentiles(totalTokens),
    },
    costUsd,
    inputPricePerMtok: price?.inputPerMtok ?? null,
    outputPricePerMtok: price?.outputPerMtok ?? null,
    finishReasons: finishReasons.size
      ? Object.fromEntries(finishReasons)
      : null,
  };
}

function deriveTraceServiceName(trace: TraceRecord): string {
  const rootSpan =
    trace.spans.find((span) => !span.parentSpanId) ?? trace.spans[0];
  return rootSpan?.serviceName ?? 'unknown';
}

function deriveTraceStartTimeUnixMs(trace: TraceRecord): number {
  if (trace.spans.length === 0) return 0;
  return Math.min(...trace.spans.map((s) => s.startTimeUnixMs));
}

function deriveTraceDurationMs(trace: TraceRecord): number {
  if (trace.spans.length === 0) return 0;
  const start = Math.min(...trace.spans.map((s) => s.startTimeUnixMs));
  const end = Math.max(
    ...trace.spans.map((s) => s.startTimeUnixMs + s.durationMs),
  );
  return end - start;
}

function deriveTraceStatusCode(trace: TraceRecord): string {
  if (trace.spans.some((s) => s.statusCode === 'ERROR')) return 'ERROR';
  if (trace.spans.some((s) => s.statusCode === 'OK')) return 'OK';
  return 'UNSET';
}

export function findErrorTraces(traces: TraceRecord[]): ErrorTraceDetail[] {
  return traces
    .filter((trace) => trace.spans.some((span) => span.hasError))
    .map((trace) => ({
      traceId: trace.traceId,
      serviceName: deriveTraceServiceName(trace),
      operationName: trace.spans[0]?.operationName ?? 'unknown',
      startTimeUnixMs: deriveTraceStartTimeUnixMs(trace),
      durationMs: deriveTraceDurationMs(trace),
      status: deriveTraceStatusCode(trace),
      spanCount: trace.spans.length,
      hasErrors: true,
      errorSpans: trace.spans
        .filter((span) => span.hasError)
        .map((span) => ({
          spanId: span.spanId,
          operationName: span.operationName,
          serviceName: span.serviceName,
          status: span.statusCode,
          errorMessage: String(
            span.tags['error.message'] ??
              span.tags['exception.message'] ??
              'Unknown error',
          ),
          errorType: asString(
            span.tags['error.type'] ?? span.tags['exception.type'],
          ),
          stackTrace: truncate(
            asString(span.tags['exception.stacktrace']),
            500,
          ),
          isLlmError: isLlmSpan(span),
          llmProvider: getLlmSpan(span)?.provider ?? null,
          llmModel: getLlmSpan(span)?.model ?? null,
        })),
    }));
}

export function rankExpensiveTraces(
  traces: TraceRecord[],
): RankedTraceSummary[] {
  return traces
    .map((trace) => summarizeRankedTrace(trace))
    .filter((trace) => trace.tokens.total > 0)
    .sort(
      // Sort by USD cost when we have it; fall back to tokens when every
      // trace is unpriced so the tool still returns something useful.
      (a, b) =>
        b.costUsd - a.costUsd ||
        b.tokens.total - a.tokens.total ||
        b.durationMs - a.durationMs,
    );
}

export function rankSlowTraces(traces: TraceRecord[]): RankedTraceSummary[] {
  return traces
    .map((trace) => summarizeRankedTrace(trace))
    .filter((trace) => trace.llmSpanCount > 0)
    .sort(
      (a, b) => b.durationMs - a.durationMs || b.tokens.total - a.tokens.total,
    );
}

function summarizeRankedTrace(trace: TraceRecord): RankedTraceSummary {
  const ltm = summarizeTraceTokens(trace);
  const llmSpans = trace.spans.filter(isLlmSpan);
  const models = Array.from(
    new Set(
      llmSpans.flatMap((span) => {
        const llm = getLlmSpan(span);
        return llm?.model ? [llm.model] : [];
      }),
    ),
  );
  const durationMs = deriveTraceDurationMs(trace);
  return {
    traceId: trace.traceId,
    serviceName: deriveTraceServiceName(trace),
    operationName: trace.spans[0]?.operationName ?? 'unknown',
    startTimeUnixMs: deriveTraceStartTimeUnixMs(trace),
    durationMs,
    models,
    tokens: {
      prompt: ltm.prompt,
      completion: ltm.completion,
      total: ltm.total,
    },
    costUsd: ltm.costUsd,
    hasUnpricedSpans: ltm.hasUnpricedSpans,
    status: deriveTraceStatusCode(trace),
    hasErrors: trace.spans.some((span) => span.hasError),
    llmSpanCount: llmSpans.length,
  };
}

export function listToolUsage(traces: TraceRecord[]): LlmToolUsage[] {
  const tools = new Map<string, LlmToolUsage>();

  for (const trace of traces) {
    for (const span of trace.spans) {
      if (!isToolSpan(span)) continue;
      const toolName = getToolName(span);
      const current = tools.get(toolName) ?? {
        toolName,
        usageCount: 0,
        services: [],
        firstSeenUnixMs: span.startTimeUnixMs,
        lastSeenUnixMs: span.startTimeUnixMs,
      };
      current.usageCount += 1;
      if (!current.services.includes(span.serviceName))
        current.services.push(span.serviceName);
      current.firstSeenUnixMs = Math.min(
        current.firstSeenUnixMs,
        span.startTimeUnixMs,
      );
      current.lastSeenUnixMs = Math.max(
        current.lastSeenUnixMs,
        span.startTimeUnixMs,
      );
      tools.set(toolName, current);
    }
  }

  return Array.from(tools.values())
    .map((tool) => ({ ...tool, services: tool.services.sort() }))
    .sort(
      (a, b) =>
        b.usageCount - a.usageCount || a.toolName.localeCompare(b.toolName),
    );
}

export function calculatePercentiles(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { mean: 0, median: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower] ?? 0;
    const weight = index - lower;
    return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
  };

  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(0.5),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

function summarizeTraceTokens(trace: TraceRecord): {
  prompt: number;
  completion: number;
  total: number;
  costUsd: number;
  hasUnpricedSpans: boolean;
} {
  let prompt = 0;
  let completion = 0;
  let total = 0;
  let costUsd = 0;
  let hasUnpricedSpans = false;
  for (const span of trace.spans) {
    const llm = getLlmSpan(span);
    if (!llm) continue;
    prompt += llm.promptTokens;
    completion += llm.completionTokens;
    total += llm.totalTokens;
    const cost = estimateCostUsd(
      llm.model,
      llm.promptTokens,
      llm.completionTokens,
    );
    if (cost === null) hasUnpricedSpans = true;
    else costUsd += cost;
  }
  return { prompt, completion, total, costUsd, hasUnpricedSpans };
}

function getLlmSpan(span: SpanRecord) {
  const provider = asString(
    span.tags['gen_ai.system'] ?? span.tags['llm.vendor'],
  );
  const requestModel = asString(
    span.tags['gen_ai.request.model'] ?? span.tags['llm.request.model'],
  );
  const responseModel = asString(
    span.tags['gen_ai.response.model'] ?? span.tags['llm.response.model'],
  );
  const model = responseModel ?? requestModel;
  const finishReasons = parseFinishReasons(
    span.tags['gen_ai.response.finish_reasons'] ??
      span.tags['llm.response.finish_reasons'],
  );
  const promptTokens =
    asNumber(span.tags['gen_ai.usage.prompt_tokens']) ??
    asNumber(span.tags['gen_ai.usage.input_tokens']) ??
    asNumber(span.tags['llm.usage.prompt_tokens']) ??
    asNumber(span.tags['llm.usage.input_tokens']) ??
    0;
  const completionTokens =
    asNumber(span.tags['gen_ai.usage.completion_tokens']) ??
    asNumber(span.tags['gen_ai.usage.output_tokens']) ??
    asNumber(span.tags['llm.usage.completion_tokens']) ??
    asNumber(span.tags['llm.usage.output_tokens']) ??
    0;
  const totalTokens =
    asNumber(span.tags['gen_ai.usage.total_tokens']) ??
    asNumber(span.tags['llm.usage.total_tokens']) ??
    promptTokens + completionTokens;

  const hasLLMSignal =
    model !== undefined ||
    promptTokens > 0 ||
    completionTokens > 0 ||
    totalTokens > 0 ||
    finishReasons.length > 0;

  if (!hasLLMSignal) {
    return null;
  }

  return {
    provider,
    requestModel,
    responseModel,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    finishReasons,
  };
}

function isLlmSpan(span: SpanRecord): boolean {
  return getLlmSpan(span) !== null;
}

function isToolSpan(span: SpanRecord): boolean {
  const traceloopKind = asString(span.tags['traceloop.span.kind']);
  const genAiOperation = asString(span.tags['gen_ai.operation.name']);
  return (
    traceloopKind === 'tool' ||
    genAiOperation === 'tool' ||
    span.operationName.endsWith('.tool')
  );
}

function getToolName(span: SpanRecord): string {
  return (
    asString(span.tags['gen_ai.tool.name']) ??
    asString(span.tags['llm.tool.name']) ??
    asString(span.tags['traceloop.tool.name']) ??
    span.operationName
  );
}

function parseFinishReasons(value: TagValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function asString(value: TagValue | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return undefined;
}

function asNumber(value: TagValue | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
