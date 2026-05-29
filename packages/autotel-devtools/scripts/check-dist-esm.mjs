// Loads the BUILT ESM bundle the way Node (and `npx autotel-devtools`) loads it, and
// exercises all three protobuf decoders. This reproduces the exact runtime where the
// 5.0.1 bug surfaced (`protobuf.Root is not a constructor`) — a failure that source-level
// and vitest tests miss because vite's loader resolves CJS interop differently than Node.
//
// Exits non-zero on any failure so it can gate `prepublishOnly` and run inside the suite.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import protobuf from 'protobufjs'

const here = dirname(fileURLToPath(import.meta.url))
const distEntry = resolve(here, '../dist/server/index.js')

const { decodeOtlpTraceRequest, decodeOtlpLogsRequest, decodeOtlpMetricsRequest, parseOtlpTraces } =
  await import(distEntry)

// Independently encode an OTLP/protobuf trace request (canonical field numbers).
const { root } = protobuf.parse(
  `syntax = "proto3";
   package check;
   message AnyValue { oneof v { string string_value = 1; } }
   message KeyValue { string key = 1; AnyValue value = 2; }
   message Resource { repeated KeyValue attributes = 1; }
   message Span { bytes trace_id = 1; bytes span_id = 2; string name = 5; uint32 kind = 6; fixed64 start_time_unix_nano = 7; fixed64 end_time_unix_nano = 8; }
   message ScopeSpans { repeated Span spans = 2; }
   message ResourceSpans { Resource resource = 1; repeated ScopeSpans scope_spans = 2; }
   message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }`,
  { keepCase: false },
)
const Req = root.lookupType('check.ExportTraceServiceRequest')
const bytes = Buffer.from(
  Req.encode(
    Req.create({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'dist-smoke' } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
                  spanId: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
                  name: 'dist-span',
                  kind: 2,
                  startTimeUnixNano: '1000000',
                  endTimeUnixNano: '2000000',
                },
              ],
            },
          ],
        },
      ],
    }),
  ).finish(),
)

// The decoder must not throw (the bug threw "protobuf.Root is not a constructor"),
// and must decode into the parsed shape with hex-normalised IDs.
const traces = parseOtlpTraces(decodeOtlpTraceRequest(bytes))
assert.equal(traces.length, 1, 'expected one trace')
assert.equal(traces[0].traceId, '0102030405060708090a0b0c0d0e0f10', 'trace ID hex mismatch')
assert.equal(traces[0].spans[0].spanId, '0102030405060708', 'span ID hex mismatch')
assert.equal(traces[0].spans[0].name, 'dist-span', 'span name mismatch')
assert.equal(traces[0].service, 'dist-smoke', 'service mismatch')

// Logs and metrics decoders build their own proto roots too — exercise them so a
// broken bundle can't slip through on a signal the trace path doesn't cover.
assert.doesNotThrow(() => decodeOtlpLogsRequest(Buffer.from([])), 'logs decoder threw')
assert.doesNotThrow(() => decodeOtlpMetricsRequest(Buffer.from([])), 'metrics decoder threw')

console.log('dist ESM smoke OK — protobuf decoders load and decode from the built bundle')
