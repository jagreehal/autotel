/**
 * The OTLP/JSON envelope, as the spec defines it.
 *
 * Every field is optional because a payload arrives from another process and
 * may be from an older SDK, a partial exporter, or a hand-rolled client. The
 * shape is still known - it is protobuf's JSON mapping - so it is written down
 * here once instead of being read through `any` at each access.
 *
 * Decoded OTLP/protobuf shares this camelCase shape, so both paths use it.
 */

/** An OTLP AnyValue: exactly one of these fields is set. */
export interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  bytesValue?: string;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
}

/** An OTLP KeyValue: one attribute. */
export interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}

/** The instrumentation scope a signal was recorded by. */
export interface OtlpScope {
  name?: string;
  version?: string;
}

/** The resource a signal was recorded on. */
export interface OtlpResource {
  attributes?: OtlpKeyValue[];
}

export interface OtlpSpanEvent {
  name?: string;
  timeUnixNano?: string;
  attributes?: OtlpKeyValue[];
}

export interface OtlpSpanLink {
  traceId?: string;
  spanId?: string;
  attributes?: OtlpKeyValue[];
}

export interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  /** Numeric in protobuf, the `SPAN_KIND_*` string in some JSON exporters. */
  kind?: number | string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: OtlpKeyValue[];
  status?: { code?: number | string; message?: string };
  events?: OtlpSpanEvent[];
  links?: OtlpSpanLink[];
}

export interface OtlpScopeSpans {
  scope?: OtlpScope;
  spans?: OtlpSpan[];
}

export interface OtlpResourceSpans {
  resource?: OtlpResource;
  scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpTraceRequest {
  resourceSpans?: OtlpResourceSpans[];
}

export interface OtlpLogRecord {
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  traceId?: string;
  spanId?: string;
  severityText?: string;
  severityNumber?: number;
  /** Set by SDKs that emit events as logs (Claude Code among them). */
  eventName?: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
}

export interface OtlpScopeLogs {
  scope?: OtlpScope;
  logRecords?: OtlpLogRecord[];
}

export interface OtlpResourceLogs {
  resource?: OtlpResource;
  scopeLogs?: OtlpScopeLogs[];
}

export interface OtlpLogsRequest {
  resourceLogs?: OtlpResourceLogs[];
}

export interface OtlpExemplar {
  asDouble?: number | string;
  asInt?: number | string;
  timeUnixNano?: string;
  /** Hex on the JSON wire, base64 in protobuf; normalised at parse. */
  traceId?: string;
  spanId?: string;
  filteredAttributes?: OtlpKeyValue[];
}

export interface OtlpQuantileValue {
  quantile?: number;
  value?: number;
}

export interface OtlpExponentialBuckets {
  offset?: number;
  bucketCounts?: Array<number | string>;
}

export interface OtlpDataPoint {
  asDouble?: number | string;
  asInt?: number | string;
  /** Histogram and summary points carry a count instead of a value. */
  count?: number | string;
  /** Histogram/summary total. Distinct from `count`. */
  sum?: number | string;
  min?: number | string;
  max?: number | string;
  /** Histogram: one count per bucket, one longer than `explicitBounds`. */
  bucketCounts?: Array<number | string>;
  /** Histogram: upper bounds; the final bucket is the +Inf overflow. */
  explicitBounds?: Array<number | string>;
  /** Exponential histogram resolution and the buckets around zero. */
  scale?: number;
  zeroCount?: number | string;
  zeroThreshold?: number | string;
  positive?: OtlpExponentialBuckets;
  negative?: OtlpExponentialBuckets;
  /** Summary: precomputed quantiles. */
  quantileValues?: OtlpQuantileValue[];
  /** Exemplars link a data point back to the trace that produced it. */
  exemplars?: OtlpExemplar[];
  attributes?: OtlpKeyValue[];
  timeUnixNano?: string;
  startTimeUnixNano?: string;
}

/**
 * One arm of a Metric's per-type oneof. `aggregationTemporality` is numeric in
 * protobuf and most JSON, the `AGGREGATION_TEMPORALITY_*` string elsewhere.
 */
export interface OtlpAggregation {
  dataPoints?: OtlpDataPoint[];
  aggregationTemporality?: number | string;
  /** Sums only: a non-monotonic sum is an up/down counter, not a rate. */
  isMonotonic?: boolean;
}

export interface OtlpMetric {
  name?: string;
  unit?: string;
  description?: string;
  sum?: OtlpAggregation;
  gauge?: OtlpAggregation;
  histogram?: OtlpAggregation;
  exponentialHistogram?: OtlpAggregation;
  summary?: OtlpAggregation;
}

export interface OtlpScopeMetrics {
  scope?: OtlpScope;
  metrics?: OtlpMetric[];
}

export interface OtlpResourceMetrics {
  resource?: OtlpResource;
  scopeMetrics?: OtlpScopeMetrics[];
}

export interface OtlpMetricsRequest {
  resourceMetrics?: OtlpResourceMetrics[];
}

/**
 * An exporter's payload, read as the envelope it claims to be.
 *
 * SAFETY: this is the one place the receiver trusts the wire. Every field of
 * every envelope above is optional, so a payload that is not what it claims
 * reads back as empty arrays and undefined fields rather than throwing - which
 * is what the callers below rely on when they find no spans to add.
 */
export function otlpEnvelope<TEnvelope>(
  payload: unknown,
): TEnvelope | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  // SAFETY: see the note above.
  return payload as TEnvelope;
}
