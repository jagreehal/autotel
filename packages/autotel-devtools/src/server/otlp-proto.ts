// src/server/otlp-proto.ts
//
// Decodes binary OTLP/protobuf request bodies (`Content-Type: application/x-protobuf`)
// into the same plain-object shape the JSON parsers in `./otlp` already consume.
//
// The OpenTelemetry Python/Java/Go SDKs default to `http/protobuf` over OTLP HTTP. We
// embed the (stable, v1) OTLP proto definitions and let protobufjs decode by reflection,
// which needs no codegen step and no `.proto` assets in the build.
//
// The OTLP proto schema is frozen at v1 and only ever adds fields, so embedding the
// subset we read is safe: unknown/newer fields are skipped by the decoder.
//
// `toObject` is configured to mirror OTLP/JSON exactly: 64-bit ints become decimal
// strings and `bytes` (trace/span IDs) become base64 — which `normalizeHexId` in
// `./otlp` already converts to hex. Enums are left numeric, which the parsers handle.

// Default import (not `* as`): under esbuild's CJS->ESM interop a namespace import
// only reliably exposes `.default`, leaving `protobuf.Root`/`protobuf.parse` undefined
// in the bundled ESM output. The default import binds to protobufjs's `module.exports`,
// so the constructors resolve in both the ESM and CJS bundles. The dist ESM smoke test
// in `__tests__/otlp-proto.dist.test.ts` covers this.
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import protobuf from 'protobufjs';
import type { IConversionOptions, Root } from 'protobufjs';

/**
 * True for OTLP/protobuf bodies. The OpenTelemetry Python/Java/Go SDKs default to
 * `http/protobuf` over OTLP HTTP, sending `application/x-protobuf` (or
 * `application/protobuf`). Anything else (JSON, unset) is treated as JSON.
 */
export function isProtobufContentType(contentType?: string): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase();
  return (
    value.includes('application/x-protobuf') ||
    value.includes('application/protobuf')
  );
}

const gunzipAsync = promisify(gunzip);

/** Far past any real export batch, and short of what a small gzip bomb inflates to. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/**
 * OTLP/HTTP allows gzip on either encoding, and the OpenTelemetry Collector's
 * `otlphttp` exporter sends it by default. Rejects on a corrupt or oversized body.
 */
export async function decompressOtlpBody(
  body: Buffer,
  contentEncoding?: string,
): Promise<Buffer> {
  if (contentEncoding?.trim().toLowerCase() !== 'gzip') return body;
  return gunzipAsync(body, { maxOutputLength: MAX_INFLATED_BYTES });
}

const COMMON_PROTO = `
syntax = "proto3";
package opentelemetry.proto.common.v1;

message AnyValue {
  oneof value {
    string string_value = 1;
    bool bool_value = 2;
    int64 int_value = 3;
    double double_value = 4;
    ArrayValue array_value = 5;
    KeyValueList kvlist_value = 6;
    bytes bytes_value = 7;
  }
}
message ArrayValue { repeated AnyValue values = 1; }
message KeyValueList { repeated KeyValue values = 1; }
message KeyValue {
  string key = 1;
  AnyValue value = 2;
}
message InstrumentationScope {
  string name = 1;
  string version = 2;
  repeated KeyValue attributes = 3;
  uint32 dropped_attributes_count = 4;
}
`;

const RESOURCE_PROTO = `
syntax = "proto3";
package opentelemetry.proto.resource.v1;

message Resource {
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 1;
  uint32 dropped_attributes_count = 2;
}
`;

const TRACE_PROTO = `
syntax = "proto3";
package opentelemetry.proto.trace.v1;

message ResourceSpans {
  opentelemetry.proto.resource.v1.Resource resource = 1;
  repeated ScopeSpans scope_spans = 2;
  string schema_url = 3;
}
message ScopeSpans {
  opentelemetry.proto.common.v1.InstrumentationScope scope = 1;
  repeated Span spans = 2;
  string schema_url = 3;
}
message Span {
  bytes trace_id = 1;
  bytes span_id = 2;
  string trace_state = 3;
  bytes parent_span_id = 4;
  fixed32 flags = 16;
  string name = 5;
  SpanKind kind = 6;
  fixed64 start_time_unix_nano = 7;
  fixed64 end_time_unix_nano = 8;
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 9;
  uint32 dropped_attributes_count = 10;
  repeated Event events = 11;
  uint32 dropped_events_count = 12;
  repeated Link links = 13;
  uint32 dropped_links_count = 14;
  Status status = 15;

  enum SpanKind {
    SPAN_KIND_UNSPECIFIED = 0;
    SPAN_KIND_INTERNAL = 1;
    SPAN_KIND_SERVER = 2;
    SPAN_KIND_CLIENT = 3;
    SPAN_KIND_PRODUCER = 4;
    SPAN_KIND_CONSUMER = 5;
  }
  message Event {
    fixed64 time_unix_nano = 1;
    string name = 2;
    repeated opentelemetry.proto.common.v1.KeyValue attributes = 3;
    uint32 dropped_attributes_count = 4;
  }
  message Link {
    bytes trace_id = 1;
    bytes span_id = 2;
    string trace_state = 3;
    repeated opentelemetry.proto.common.v1.KeyValue attributes = 4;
    uint32 dropped_attributes_count = 5;
    fixed32 flags = 6;
  }
}
message Status {
  reserved 1;
  string message = 2;
  StatusCode code = 3;

  enum StatusCode {
    STATUS_CODE_UNSET = 0;
    STATUS_CODE_OK = 1;
    STATUS_CODE_ERROR = 2;
  }
}
message ExportTraceServiceRequest {
  repeated ResourceSpans resource_spans = 1;
}
`;

const LOGS_PROTO = `
syntax = "proto3";
package opentelemetry.proto.logs.v1;

enum SeverityNumber {
  SEVERITY_NUMBER_UNSPECIFIED = 0;
  SEVERITY_NUMBER_TRACE = 1;
  SEVERITY_NUMBER_TRACE2 = 2;
  SEVERITY_NUMBER_TRACE3 = 3;
  SEVERITY_NUMBER_TRACE4 = 4;
  SEVERITY_NUMBER_DEBUG = 5;
  SEVERITY_NUMBER_DEBUG2 = 6;
  SEVERITY_NUMBER_DEBUG3 = 7;
  SEVERITY_NUMBER_DEBUG4 = 8;
  SEVERITY_NUMBER_INFO = 9;
  SEVERITY_NUMBER_INFO2 = 10;
  SEVERITY_NUMBER_INFO3 = 11;
  SEVERITY_NUMBER_INFO4 = 12;
  SEVERITY_NUMBER_WARN = 13;
  SEVERITY_NUMBER_WARN2 = 14;
  SEVERITY_NUMBER_WARN3 = 15;
  SEVERITY_NUMBER_WARN4 = 16;
  SEVERITY_NUMBER_ERROR = 17;
  SEVERITY_NUMBER_ERROR2 = 18;
  SEVERITY_NUMBER_ERROR3 = 19;
  SEVERITY_NUMBER_ERROR4 = 20;
  SEVERITY_NUMBER_FATAL = 21;
  SEVERITY_NUMBER_FATAL2 = 22;
  SEVERITY_NUMBER_FATAL3 = 23;
  SEVERITY_NUMBER_FATAL4 = 24;
}
message ResourceLogs {
  opentelemetry.proto.resource.v1.Resource resource = 1;
  repeated ScopeLogs scope_logs = 2;
  string schema_url = 3;
}
message ScopeLogs {
  opentelemetry.proto.common.v1.InstrumentationScope scope = 1;
  repeated LogRecord log_records = 2;
  string schema_url = 3;
}
message LogRecord {
  reserved 4;
  fixed64 time_unix_nano = 1;
  fixed64 observed_time_unix_nano = 11;
  SeverityNumber severity_number = 2;
  string severity_text = 3;
  opentelemetry.proto.common.v1.AnyValue body = 5;
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 6;
  uint32 dropped_attributes_count = 7;
  fixed32 flags = 8;
  bytes trace_id = 9;
  bytes span_id = 10;
  string event_name = 12;
}
message ExportLogsServiceRequest {
  repeated ResourceLogs resource_logs = 1;
}
`;

// What OTLP/HTTP answers a protobuf client with on a 4xx or 5xx.
const RPC_STATUS_PROTO = `
syntax = "proto3";
package google.rpc;

message Status {
  int32 code = 1;
  string message = 2;
}
`;

// Metrics schema. Decodes the structural envelope AND the Sum/Gauge/Histogram
// data points (number + histogram), so coding-agent counters
// (token/cost/lines/…) and their attributes survive — not just the metric name.
// Field numbers match the OTLP v1 spec. Every aggregation and exemplar field
// the viewer renders is decoded so protobuf and JSON ingestion have parity.
const METRICS_PROTO = `
syntax = "proto3";
package opentelemetry.proto.metrics.v1;

enum AggregationTemporality {
  AGGREGATION_TEMPORALITY_UNSPECIFIED = 0;
  AGGREGATION_TEMPORALITY_DELTA = 1;
  AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
}
message ResourceMetrics {
  opentelemetry.proto.resource.v1.Resource resource = 1;
  repeated ScopeMetrics scope_metrics = 2;
  string schema_url = 3;
}
message ScopeMetrics {
  opentelemetry.proto.common.v1.InstrumentationScope scope = 1;
  repeated Metric metrics = 2;
  string schema_url = 3;
}
message Metric {
  string name = 1;
  string description = 2;
  string unit = 3;
  oneof data {
    Gauge gauge = 5;
    Sum sum = 7;
    Histogram histogram = 9;
    ExponentialHistogram exponential_histogram = 10;
    Summary summary = 11;
  }
}
message Gauge {
  repeated NumberDataPoint data_points = 1;
}
message Sum {
  repeated NumberDataPoint data_points = 1;
  AggregationTemporality aggregation_temporality = 2;
  bool is_monotonic = 3;
}
message Histogram {
  repeated HistogramDataPoint data_points = 1;
  AggregationTemporality aggregation_temporality = 2;
}
message ExponentialHistogram {
  repeated ExponentialHistogramDataPoint data_points = 1;
  AggregationTemporality aggregation_temporality = 2;
}
message Summary {
  repeated SummaryDataPoint data_points = 1;
}
message NumberDataPoint {
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 7;
  fixed64 start_time_unix_nano = 2;
  fixed64 time_unix_nano = 3;
  oneof value {
    double as_double = 4;
    sfixed64 as_int = 6;
  }
  repeated Exemplar exemplars = 5;
  uint32 flags = 8;
}
message HistogramDataPoint {
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 9;
  fixed64 start_time_unix_nano = 2;
  fixed64 time_unix_nano = 3;
  fixed64 count = 4;
  double sum = 5;
  repeated fixed64 bucket_counts = 6;
  repeated double explicit_bounds = 7;
  repeated Exemplar exemplars = 8;
  uint32 flags = 10;
  double min = 11;
  double max = 12;
}
message ExponentialHistogramDataPoint {
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 1;
  fixed64 start_time_unix_nano = 2;
  fixed64 time_unix_nano = 3;
  fixed64 count = 4;
  double sum = 5;
  sint32 scale = 6;
  fixed64 zero_count = 7;
  Buckets positive = 8;
  Buckets negative = 9;
  uint32 flags = 10;
  repeated Exemplar exemplars = 11;
  double min = 12;
  double max = 13;
  double zero_threshold = 14;

  message Buckets {
    sint32 offset = 1;
    repeated uint64 bucket_counts = 2;
  }
}
message SummaryDataPoint {
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 7;
  fixed64 start_time_unix_nano = 2;
  fixed64 time_unix_nano = 3;
  fixed64 count = 4;
  double sum = 5;
  repeated ValueAtQuantile quantile_values = 6;
  uint32 flags = 8;

  message ValueAtQuantile {
    double quantile = 1;
    double value = 2;
  }
}
message Exemplar {
  repeated opentelemetry.proto.common.v1.KeyValue filtered_attributes = 7;
  fixed64 time_unix_nano = 2;
  oneof value {
    double as_double = 3;
    sfixed64 as_int = 6;
  }
  bytes span_id = 4;
  bytes trace_id = 5;
}
message ExportMetricsServiceRequest {
  repeated ResourceMetrics resource_metrics = 1;
}
`;

// Mirror the OTLP/JSON encoding so the existing parsers handle protobuf input
// identically: 64-bit ints as decimal strings, bytes as base64 (IDs are then
// hex-normalized downstream), enums left numeric, defaults omitted.
const TO_OBJECT_OPTIONS: IConversionOptions = {
  longs: String,
  bytes: String,
  defaults: false,
};

let cachedRoot: Root | null = null;

function getRoot(): Root {
  if (cachedRoot) return cachedRoot;
  const root = new protobuf.Root();
  for (const source of [
    COMMON_PROTO,
    RESOURCE_PROTO,
    TRACE_PROTO,
    LOGS_PROTO,
    METRICS_PROTO,
    RPC_STATUS_PROTO,
  ]) {
    protobuf.parse(source, root, { keepCase: false });
  }
  root.resolveAll();
  cachedRoot = root;
  return root;
}

function decodeRequest(
  typeName: string,
  body: Uint8Array,
): Record<string, unknown> {
  const messageType = getRoot().lookupType(typeName);
  const message = messageType.decode(body);
  return messageType.toObject(message, TO_OBJECT_OPTIONS) as Record<
    string,
    unknown
  >;
}

/** Decode an OTLP/protobuf `ExportTraceServiceRequest` into the OTLP/JSON object shape. */
export function decodeOtlpTraceRequest(
  body: Uint8Array,
): Record<string, unknown> {
  return decodeRequest(
    'opentelemetry.proto.trace.v1.ExportTraceServiceRequest',
    body,
  );
}

/** Decode an OTLP/protobuf `ExportLogsServiceRequest` into the OTLP/JSON object shape. */
export function decodeOtlpLogsRequest(
  body: Uint8Array,
): Record<string, unknown> {
  return decodeRequest(
    'opentelemetry.proto.logs.v1.ExportLogsServiceRequest',
    body,
  );
}

/** Decode an OTLP/protobuf `ExportMetricsServiceRequest` into the OTLP/JSON object shape. */
export function decodeOtlpMetricsRequest(
  body: Uint8Array,
): Record<string, unknown> {
  return decodeRequest(
    'opentelemetry.proto.metrics.v1.ExportMetricsServiceRequest',
    body,
  );
}

/** The body of a failed OTLP/protobuf request: a `google.rpc.Status`, per the spec. */
export function encodeOtlpError(message: string): Uint8Array {
  const status = getRoot().lookupType('google.rpc.Status');
  return status.encode(status.create({ message })).finish();
}

const REQUEST_TYPES = {
  traces: 'opentelemetry.proto.trace.v1.ExportTraceServiceRequest',
  logs: 'opentelemetry.proto.logs.v1.ExportLogsServiceRequest',
  metrics: 'opentelemetry.proto.metrics.v1.ExportMetricsServiceRequest',
} as const;

/** An OTLP request as JSON: an OTLP/JSON body, or a protobuf decode's `toObject`. */
export type OtlpJson =
  string | number | boolean | null | OtlpJson[] | { [key: string]: OtlpJson };

const HEX_ID = /^(?:[\da-f]{16}|[\da-f]{32})$/i;
const ID_KEYS = new Set(['traceId', 'spanId', 'parentSpanId']);

// OTLP/JSON carries ids as hex, but protobufjs reads a `bytes` string as
// base64; ids decoded from protobuf are already base64 and pass through.
function idsToBase64(value: OtlpJson): OtlpJson {
  if (Array.isArray(value)) return value.map(idsToBase64);
  if (!(value instanceof Object)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      ID_KEYS.has(key) && HEX_ID.test(String(item))
        ? Buffer.from(String(item), 'hex').toString('base64')
        : idsToBase64(item),
    ]),
  );
}

/**
 * Encode an OTLP/JSON-shaped request (what the decoders above return, or an
 * OTLP/JSON body) back to protobuf, for re-export over gRPC. Fields outside the
 * embedded schema subset are dropped.
 */
export function encodeOtlpRequest(
  signal: keyof typeof REQUEST_TYPES,
  request: OtlpJson,
): Uint8Array {
  const messageType = getRoot().lookupType(REQUEST_TYPES[signal]);
  const plain = idsToBase64(request);
  if (!(plain instanceof Object) || Array.isArray(plain))
    throw new TypeError(`OTLP ${signal} request is not an object`);
  return messageType.encode(messageType.fromObject(plain)).finish();
}
