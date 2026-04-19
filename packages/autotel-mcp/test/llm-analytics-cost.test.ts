import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectUsage,
  getModelStats,
  rankExpensiveTraces,
} from '../src/modules/llm-analytics';
import { resetCostCatalogCache } from '../src/modules/llm-pricing';
import type { SpanRecord, TraceRecord } from '../src/types';

function makeLlmSpan(
  model: string,
  promptTokens: number,
  completionTokens: number,
  durationMs = 100,
  serviceName = 'agent',
  traceId = `trace-${Math.random().toString(16).slice(2, 10)}`,
): SpanRecord {
  return {
    traceId,
    spanId: `s-${Math.random().toString(16).slice(2, 10)}`,
    parentSpanId: null,
    operationName: 'llm.chat',
    serviceName,
    startTimeUnixMs: 1,
    durationMs,
    statusCode: 'OK',
    hasError: false,
    tags: {
      'gen_ai.request.model': model,
      'gen_ai.usage.prompt_tokens': promptTokens,
      'gen_ai.usage.completion_tokens': completionTokens,
      'gen_ai.usage.total_tokens': promptTokens + completionTokens,
    },
  };
}

function makeTrace(spans: SpanRecord[]): TraceRecord {
  const traceId = spans[0]!.traceId;
  return {
    traceId,
    spans: spans.map((s) => ({ ...s, traceId })),
  };
}

describe('LLM analytics with cost attribution', () => {
  beforeEach(() => {
    delete process.env.AUTOTEL_LLM_PRICES_JSON;
    resetCostCatalogCache();
  });
  afterEach(() => {
    delete process.env.AUTOTEL_LLM_PRICES_JSON;
    resetCostCatalogCache();
  });

  it('collectUsage returns USD totals and per-model cost', () => {
    const traces = [
      makeTrace([makeLlmSpan('gpt-4o', 100_000, 50_000)]),
      makeTrace([makeLlmSpan('claude-sonnet-4-6', 1_000_000, 1_000_000)]),
    ];
    const report = collectUsage(traces);

    // gpt-4o: 100k * $2.50/M = $0.25 in, 50k * $10/M = $0.50 out → $0.75
    // sonnet 4.6: 1M * $3 = $3 in, 1M * $15 = $15 out → $18
    expect(report.totalCostUsd).toBeCloseTo(18.75, 4);
    expect(report.unpricedRequests).toBe(0);

    expect(report.byModel['gpt-4o']?.costUsd).toBeCloseTo(0.75, 4);
    expect(report.byModel['gpt-4o']?.inputPricePerMtok).toBe(2.5);
    expect(report.byModel['claude-sonnet-4-6']?.costUsd).toBeCloseTo(18, 4);
  });

  it('tracks unpriced requests separately so callers can spot catalog gaps', () => {
    const traces = [
      makeTrace([makeLlmSpan('gpt-4o', 1000, 500)]),
      makeTrace([makeLlmSpan('fictional-model-9000', 1000, 500)]),
    ];
    const report = collectUsage(traces);

    expect(report.totalRequests).toBe(2);
    expect(report.unpricedRequests).toBe(1);
    // Only the priced request contributes to total cost.
    expect(report.byModel['fictional-model-9000']?.costUsd).toBe(0);
    expect(
      report.byModel['fictional-model-9000']?.inputPricePerMtok,
    ).toBeNull();
  });

  it('rankExpensiveTraces sorts by USD cost, not just tokens', () => {
    // Same token count, different models → cheaper model ranks lower.
    const cheap = makeTrace([makeLlmSpan('gpt-4o-mini', 1_000_000, 1_000_000)]);
    const expensive = makeTrace([
      makeLlmSpan('claude-opus-4-7', 1_000_000, 1_000_000),
    ]);
    const ranked = rankExpensiveTraces([cheap, expensive]);

    expect(ranked[0]?.traceId).toBe(expensive.traceId);
    expect(ranked[1]?.traceId).toBe(cheap.traceId);
    // Opus 4.7: $15 + $75 = $90. gpt-4o-mini: $0.15 + $0.60 = $0.75.
    expect(ranked[0]?.costUsd).toBeCloseTo(90, 2);
    expect(ranked[1]?.costUsd).toBeCloseTo(0.75, 2);
  });

  it('ranked trace summary reports hasUnpricedSpans when any span is uncatalogued', () => {
    const trace = makeTrace([
      makeLlmSpan('gpt-4o', 1000, 500),
      makeLlmSpan('fictional-model-xyz', 1000, 500),
    ]);
    const ranked = rankExpensiveTraces([trace]);
    expect(ranked[0]?.hasUnpricedSpans).toBe(true);
    // Priced span still contributes.
    expect(ranked[0]?.costUsd).toBeGreaterThan(0);
  });

  it('getModelStats returns costUsd and published prices for the model', () => {
    const traces = [
      makeTrace([makeLlmSpan('gpt-4o', 500_000, 250_000)]),
      makeTrace([makeLlmSpan('gpt-4o', 500_000, 250_000)]),
    ];
    const stats = getModelStats(traces, 'gpt-4o');
    expect(stats).not.toBeNull();
    // Two identical calls; cost is double the single-call cost.
    expect(stats!.costUsd).toBeCloseTo(2 * (0.5 * 2.5 + 0.25 * 10), 4);
    expect(stats!.inputPricePerMtok).toBe(2.5);
    expect(stats!.outputPricePerMtok).toBe(10);
  });
});
