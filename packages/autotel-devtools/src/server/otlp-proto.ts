// src/server/otlp-proto.ts
//
// Decodes binary OTLP/protobuf request bodies (`Content-Type: application/x-protobuf`)
// into the same plain-object shape the JSON parsers in `./otlp` already consume.
//
// Why this exists: the OpenTelemetry Python/Java/Go SDKs default to `http/protobuf`
// when exporting over OTLP HTTP, so a receiver that only understood OTLP/JSON would
// silently reject the most common real-world clients. Rather than re-implement the
// wire format, we embed the (stable, v1) OTLP proto definitions and let protobufjs
// do the decoding via reflection — no codegen step, no `.proto` assets to copy into
// the build.
//
// The OTLP proto schema is frozen at v1 and only ever adds fields, so embedding the
// subset we read is safe: unknown/newer fields are skipped by the decoder. The metrics
// schema is intentionally minimal (we only count metrics, never inspect data points).
//
// `toObject` is configured to mirror OTLP/JSON exactly: 64-bit ints become decimal
// strings and `bytes` (trace/span IDs) become base64 — which `normalizeHexId` in
// `./otlp` already converts to hex. Enums are left numeric, which the parsers handle.

import * as protobuf from 'protobufjs'

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
`

const RESOURCE_PROTO = `
syntax = "proto3";
package opentelemetry.proto.resource.v1;

message Resource {
  repeated opentelemetry.proto.common.v1.KeyValue attributes = 1;
  uint32 dropped_attributes_count = 2;
}
`

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
`

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
}
message ExportLogsServiceRequest {
  repeated ResourceLogs resource_logs = 1;
}
`

// Minimal metrics schema: the receiver only counts metrics, it never inspects data
// points. Decoding the structural envelope (resource -> scope -> metric name) is
// enough; the data-point oneof and other Metric fields are skipped as unknown fields.
const METRICS_PROTO = `
syntax = "proto3";
package opentelemetry.proto.metrics.v1;

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
}
message ExportMetricsServiceRequest {
  repeated ResourceMetrics resource_metrics = 1;
}
`

// Mirror the OTLP/JSON encoding so the existing parsers handle protobuf input
// identically: 64-bit ints as decimal strings, bytes as base64 (IDs are then
// hex-normalized downstream), enums left numeric, defaults omitted.
const TO_OBJECT_OPTIONS: protobuf.IConversionOptions = {
  longs: String,
  bytes: String,
  defaults: false,
}

let cachedRoot: protobuf.Root | null = null

function getRoot(): protobuf.Root {
  if (cachedRoot) return cachedRoot
  const root = new protobuf.Root()
  for (const source of [COMMON_PROTO, RESOURCE_PROTO, TRACE_PROTO, LOGS_PROTO, METRICS_PROTO]) {
    protobuf.parse(source, root, { keepCase: false })
  }
  root.resolveAll()
  cachedRoot = root
  return root
}

function decodeRequest(typeName: string, body: Uint8Array): Record<string, unknown> {
  const messageType = getRoot().lookupType(typeName)
  const message = messageType.decode(body)
  return messageType.toObject(message, TO_OBJECT_OPTIONS) as Record<string, unknown>
}

/** Decode an OTLP/protobuf `ExportTraceServiceRequest` into the OTLP/JSON object shape. */
export function decodeOtlpTraceRequest(body: Uint8Array): Record<string, unknown> {
  return decodeRequest('opentelemetry.proto.trace.v1.ExportTraceServiceRequest', body)
}

/** Decode an OTLP/protobuf `ExportLogsServiceRequest` into the OTLP/JSON object shape. */
export function decodeOtlpLogsRequest(body: Uint8Array): Record<string, unknown> {
  return decodeRequest('opentelemetry.proto.logs.v1.ExportLogsServiceRequest', body)
}

/** Decode an OTLP/protobuf `ExportMetricsServiceRequest` into the OTLP/JSON object shape. */
export function decodeOtlpMetricsRequest(body: Uint8Array): Record<string, unknown> {
  return decodeRequest('opentelemetry.proto.metrics.v1.ExportMetricsServiceRequest', body)
}
