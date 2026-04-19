import type { TraceRecord } from '../types';

export interface AnomalyQuery {
  service?: string;
  operation?: string;
}

export interface AnomalyResult {
  type: 'latency_spike' | 'error_rate_spike' | 'traffic_drop';
  service: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  evidence: { current: number; baseline: number; threshold: number };
  affectedTraceIds: string[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mad(values: number[], med: number): number {
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

function severityFromRatio(ratio: number): 'low' | 'medium' | 'high' {
  if (ratio >= 5) return 'high';
  if (ratio >= 2) return 'medium';
  return 'low';
}

export function detectAnomalies(
  traces: TraceRecord[],
  query: AnomalyQuery,
): AnomalyResult[] {
  // Collect spans grouped by service
  const byService = new Map<
    string,
    Array<{ traceId: string; durationMs: number; hasError: boolean }>
  >();

  for (const trace of traces) {
    for (const span of trace.spans) {
      if (query.service && span.serviceName !== query.service) continue;
      if (query.operation && span.operationName !== query.operation) continue;

      if (!byService.has(span.serviceName)) {
        byService.set(span.serviceName, []);
      }
      byService.get(span.serviceName)!.push({
        traceId: trace.traceId,
        durationMs: span.durationMs,
        hasError: span.hasError,
      });
    }
  }

  const results: AnomalyResult[] = [];

  for (const [service, spans] of byService) {
    if (spans.length < 5) continue;

    const durations = spans.map((s) => s.durationMs);
    const med = median(durations);
    const madValue = mad(durations, med);

    // Threshold is median + 3*MAD, with a minimum of 10% above median.
    // Also clamp to MIN_LATENCY_FLOOR_MS so sub-millisecond spans don't
    // trigger spurious "spike" alerts when the baseline is effectively 0.
    const MIN_LATENCY_FLOOR_MS = 10;
    const minThreshold = med * 1.1;
    const threshold = Math.max(
      med + 3 * madValue,
      minThreshold,
      MIN_LATENCY_FLOOR_MS,
    );

    const spikeSpans = spans.filter((s) => s.durationMs > threshold);
    if (spikeSpans.length > 0) {
      const maxDuration = Math.max(...spikeSpans.map((s) => s.durationMs));
      const ratio = maxDuration / med;
      results.push({
        type: 'latency_spike',
        service,
        description: `Latency spike detected in service "${service}": ${spikeSpans.length} span(s) exceeded threshold of ${threshold.toFixed(1)}ms (baseline median: ${med.toFixed(1)}ms)`,
        severity: severityFromRatio(ratio),
        evidence: { current: maxDuration, baseline: med, threshold },
        affectedTraceIds: [...new Set(spikeSpans.map((s) => s.traceId))],
      });
    }

    // Error rate check
    const errorCount = spans.filter((s) => s.hasError).length;
    const errorRate = errorCount / spans.length;

    if (errorRate > 0.1) {
      const severity: 'low' | 'medium' | 'high' =
        errorRate >= 0.5 ? 'high' : errorRate >= 0.25 ? 'medium' : 'low';
      const errorSpans = spans.filter((s) => s.hasError);
      results.push({
        type: 'error_rate_spike',
        service,
        description: `Error rate spike detected in service "${service}": ${(errorRate * 100).toFixed(1)}% of spans have errors (threshold: 10%)`,
        severity,
        evidence: { current: errorRate, baseline: 0, threshold: 0.1 },
        affectedTraceIds: [...new Set(errorSpans.map((s) => s.traceId))],
      });
    }
  }

  // Sort by severity: high > medium > low
  const severityOrder = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return results;
}
