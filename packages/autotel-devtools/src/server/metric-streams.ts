/**
 * Rich OTLP metric parsing, for the Metrics tab.
 *
 * `parseOtlpMetrics` in `otlp.ts` flattens a histogram to its `count`, which is
 * everything the Agents tab's counter-shaped session model needs. Charts need
 * the rest: buckets and bounds to draw a distribution, sum/min/max to summarise
 * one, quantiles for a summary instrument, and **exemplars**, which are what
 * turn a spike on a chart into the trace that caused it.
 *
 * Kept separate from `parseOtlpMetrics` rather than widening it, because that
 * function feeds `autotel-agents` — a browser-safe package that owns its own
 * model, and whose reducers would all have to move for a type change there.
 */

import type {
  OtlpAggregation,
  OtlpDataPoint,
  OtlpMetric,
  OtlpMetricsRequest,
} from './otlp-types';
import { otlpEnvelope } from './otlp-types';
import { flattenAttributes, nanoToMs, normalizeHexId } from './otlp';
import type { SpanAttributes } from '../widget/types';

export type MetricKind =
  'gauge' | 'sum' | 'histogram' | 'exponentialHistogram' | 'summary';

export type MetricTemporality = 'delta' | 'cumulative';

/** A data point's link back to the trace that produced it. */
export interface MetricExemplar {
  value: number;
  timestamp: number;
  traceId?: string;
  spanId?: string;
}

export interface ExponentialBuckets {
  offset: number;
  bucketCounts: number[];
}

export interface MetricPoint {
  timestamp: number;
  startTimestamp?: number;
  attributes: SpanAttributes;
  /** Gauge and sum. */
  value?: number;
  /** Histogram and summary. */
  count?: number;
  sum?: number;
  min?: number;
  max?: number;
  /** Histogram: one longer than `explicitBounds` — the last is +Inf. */
  bucketCounts?: number[];
  explicitBounds?: number[];
  /** Exponential histogram fields, preserved without lossy rebucketing. */
  scale?: number;
  zeroCount?: number;
  zeroThreshold?: number;
  positive?: ExponentialBuckets;
  negative?: ExponentialBuckets;
  /** Summary: precomputed quantiles. */
  quantiles?: Array<{ quantile: number; value: number }>;
  exemplars?: MetricExemplar[];
}

export interface MetricStreamRecord {
  name: string;
  unit?: string;
  description?: string;
  kind: MetricKind;
  temporality?: MetricTemporality;
  /** Sums only. A non-monotonic sum is an up/down counter, not a rate. */
  monotonic?: boolean;
  service: string;
  scope?: { name: string; version?: string };
  resource: SpanAttributes;
  points: MetricPoint[];
}

/** The aggregation arms of a Metric's oneof, in the order we probe them. */
const ARMS: ReadonlyArray<[MetricKind, keyof OtlpMetric]> = [
  ['gauge', 'gauge'],
  ['sum', 'sum'],
  ['histogram', 'histogram'],
  ['exponentialHistogram', 'exponentialHistogram'],
  ['summary', 'summary'],
];

export function parseOtlpMetricStreams(payload: unknown): MetricStreamRecord[] {
  const resourceMetrics =
    otlpEnvelope<OtlpMetricsRequest>(payload)?.resourceMetrics;
  if (!Array.isArray(resourceMetrics)) return [];

  const streams: MetricStreamRecord[] = [];

  for (const rm of resourceMetrics) {
    const resource = flattenAttributes(rm.resource?.attributes);
    const service = String(resource['service.name'] ?? 'unknown');

    for (const sm of rm.scopeMetrics ?? []) {
      const scope = sm.scope?.name
        ? { name: sm.scope.name, version: sm.scope.version || undefined }
        : undefined;

      for (const metric of sm.metrics ?? []) {
        const found = findAggregation(metric);
        // A metric with no recognised arm is a wire shape we do not model yet;
        // skipping it keeps the rest of the batch usable.
        if (!found) continue;

        const points = (found.aggregation.dataPoints ?? []).map((dp) =>
          readPoint(dp, found.kind),
        );
        // An empty stream would render as a chart with no lines and no
        // explanation — omit it and let the tab say there is nothing yet.
        if (points.length === 0) continue;

        streams.push({
          name: metric.name ?? '',
          unit: metric.unit || undefined,
          description: metric.description || undefined,
          kind: found.kind,
          temporality: readTemporality(found.aggregation),
          monotonic: found.aggregation.isMonotonic,
          service,
          scope,
          resource,
          points,
        });
      }
    }
  }

  return streams;
}

function findAggregation(
  metric: OtlpMetric,
): { kind: MetricKind; aggregation: OtlpAggregation } | undefined {
  for (const [kind, key] of ARMS) {
    const aggregation = metric[key] as OtlpAggregation | undefined;
    if (aggregation) return { kind, aggregation };
  }
  return undefined;
}

function readPoint(dp: OtlpDataPoint, kind: MetricKind): MetricPoint {
  const point: MetricPoint = {
    // `timeUnixNano` is the point's own time; a sender that only set the window
    // start still gets placed on the axis rather than at the epoch.
    timestamp: nanoToMs(dp.timeUnixNano || dp.startTimeUnixNano),
    startTimestamp: dp.startTimeUnixNano
      ? nanoToMs(dp.startTimeUnixNano)
      : undefined,
    attributes: flattenAttributes(dp.attributes),
  };

  if (kind === 'gauge' || kind === 'sum') {
    point.value = readNumber(dp.asDouble) ?? readNumber(dp.asInt) ?? 0;
  }

  if (kind !== 'gauge' && kind !== 'sum') {
    point.count = readNumber(dp.count);
    point.sum = readNumber(dp.sum);
    point.min = readNumber(dp.min);
    point.max = readNumber(dp.max);
  }

  if (Array.isArray(dp.bucketCounts)) {
    point.bucketCounts = dp.bucketCounts.map((n) => readNumber(n) ?? 0);
  }
  if (Array.isArray(dp.explicitBounds)) {
    point.explicitBounds = dp.explicitBounds.map((n) => readNumber(n) ?? 0);
  }

  if (kind === 'exponentialHistogram') {
    point.scale = readNumber(dp.scale);
    point.zeroCount = readNumber(dp.zeroCount);
    point.zeroThreshold = readNumber(dp.zeroThreshold);
    point.positive = readExponentialBuckets(dp.positive);
    point.negative = readExponentialBuckets(dp.negative);
  }

  if (Array.isArray(dp.quantileValues) && dp.quantileValues.length > 0) {
    point.quantiles = dp.quantileValues.map((q) => ({
      quantile: q.quantile ?? 0,
      value: q.value ?? 0,
    }));
  }

  if (Array.isArray(dp.exemplars) && dp.exemplars.length > 0) {
    point.exemplars = dp.exemplars.map((ex) => ({
      value: readNumber(ex.asDouble) ?? readNumber(ex.asInt) ?? 0,
      timestamp: nanoToMs(ex.timeUnixNano),
      traceId: normalizeHexId(ex.traceId) || undefined,
      spanId: normalizeHexId(ex.spanId) || undefined,
    }));
  }

  return point;
}

function readExponentialBuckets(
  buckets: OtlpDataPoint['positive'],
): ExponentialBuckets | undefined {
  if (!buckets || !Array.isArray(buckets.bucketCounts)) return undefined;
  return {
    offset: buckets.offset ?? 0,
    bucketCounts: buckets.bucketCounts.map((count) => readNumber(count) ?? 0),
  };
}

/**
 * Read an OTLP number.
 *
 * int64 arrives as a string in OTLP/JSON (it does not survive JSON) and as a
 * number once protobuf is decoded, so both spellings have to work.
 */
function readNumber(raw: number | string | undefined): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** 1 = DELTA, 2 = CUMULATIVE; the string enum spelling is handled too. */
function readTemporality(
  aggregation: OtlpAggregation,
): MetricTemporality | undefined {
  const raw = aggregation.aggregationTemporality;
  if (raw === 2 || raw === 'AGGREGATION_TEMPORALITY_CUMULATIVE') {
    return 'cumulative';
  }
  if (raw === 1 || raw === 'AGGREGATION_TEMPORALITY_DELTA') return 'delta';
  return undefined;
}
