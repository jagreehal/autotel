import {
  JsonTraceSerializer,
  ProtobufTraceSerializer,
} from '@opentelemetry/otlp-transformer';
import type { TelemetryBackend } from 'autotel-mcp';

/**
 * Ingest-to-queryable lag: emit one probe span, then poll the read backend
 * until it comes back.
 *
 * This is the number that decides whether a write-then-read agent loop works at
 * all. Observed lag across hosted backends spans two orders of magnitude — some
 * are queryable in well under a second, others take the better part of a minute,
 * which is long enough that an agent reading back its own trace sees nothing and
 * concludes the operation produced no telemetry. Reachability alone doesn't tell
 * you which kind of backend you're pointed at; this does.
 *
 * The probe rides on a unique service name rather than a trace id, because
 * `searchTraces({ service })` is the one query every backend supports.
 *
 * The span is serialized by the OTel transformer rather than hand-built, so the
 * payload is whatever the current spec says it is. Encoding matters: protobuf is
 * the encoding OTLP/HTTP receivers must accept, and several hosted vendors
 * (Logfire among them) accept nothing else — but the built-in collector reads
 * JSON, hence the switch.
 */

/** OTLP/HTTP payload encodings. */
export type OtlpEncoding = 'protobuf' | 'json';

/** Enough of a ReadableSpan for the OTLP serializers. */
export interface ProbeSpan {
  name: string;
  kind: number;
  spanContext: () => { traceId: string; spanId: string; traceFlags: number };
  parentSpanContext: undefined;
  startTime: [number, number];
  endTime: [number, number];
  duration: [number, number];
  status: { code: number };
  attributes: Record<string, never>;
  links: never[];
  events: never[];
  ended: true;
  resource: { attributes: Record<string, string> };
  instrumentationScope: { name: string };
  droppedAttributesCount: number;
  droppedEventsCount: number;
  droppedLinksCount: number;
}

const PROBE_SPAN_NAME = 'autotel.freshness.probe';
const PROBE_SCOPE = 'autotel-cli/freshness';
/** Nominal probe span duration; a zero-length span reads oddly in a UI. */
const PROBE_DURATION_MS = 1;

function randomHex(bytes: number): string {
  const out: string[] = [];
  for (let index = 0; index < bytes; index++) {
    out.push(
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, '0'),
    );
  }
  return out.join('');
}

/** Epoch ms → OTel's `[seconds, nanoseconds]` pair. */
function toHrTime(ms: number): [number, number] {
  const seconds = Math.floor(ms / 1000);
  return [seconds, Math.round((ms - seconds * 1000) * 1_000_000)];
}

/** One finished span, ready for either serializer. */
export function buildProbeSpan(service: string, startMs: number): ProbeSpan {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  return {
    name: PROBE_SPAN_NAME,
    kind: 0, // INTERNAL
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
    parentSpanContext: undefined,
    startTime: toHrTime(startMs),
    endTime: toHrTime(startMs + PROBE_DURATION_MS),
    duration: toHrTime(PROBE_DURATION_MS),
    status: { code: 0 }, // UNSET
    attributes: {},
    links: [],
    events: [],
    ended: true,
    resource: { attributes: { 'service.name': service } },
    instrumentationScope: { name: PROBE_SCOPE },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

/** What encodeProbe() answers with. */
interface EncodeProbeResult {
  body: Uint8Array;
  contentType: string;
}

/** Serialize a probe span into an OTLP request body plus its content type. */
export function encodeProbe(
  span: ProbeSpan,
  encoding: OtlpEncoding,
): EncodeProbeResult {
  // The serializers type their input as ReadableSpan; the probe carries every
  // field they read, but not the SDK's internal ones.
  const spans = [span] as unknown as Parameters<
    typeof ProtobufTraceSerializer.serializeRequest
  >[0];
  return encoding === 'json'
    ? {
        body: JsonTraceSerializer.serializeRequest(spans) ?? new Uint8Array(),
        contentType: 'application/json',
      }
    : {
        body:
          ProtobufTraceSerializer.serializeRequest(spans) ?? new Uint8Array(),
        contentType: 'application/x-protobuf',
      };
}

/**
 * Parse the standard `OTEL_EXPORTER_OTLP_HEADERS` format (`k=v,k2=v2`).
 *
 * Hosted OTLP endpoints all require an auth header, and this is the variable
 * users already set for their exporters — so the probe reads the same one
 * rather than inventing a flag that would put a token in argv.
 */
export function otlpHeadersFromEnv(
  raw: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (raw ?? '').split(',')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue; // no '=' at all, or an empty key
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key === '') continue;
    headers[key] = value;
  }
  return headers;
}

/** POST an OTLP/HTTP trace. Kept separate so tests never touch the network. */
export async function sendOtlpTrace(
  endpoint: string,
  span: ProbeSpan,
  headers: Record<string, string> = {},
  encoding: OtlpEncoding = 'protobuf',
): Promise<void> {
  const url = resolveOtlpTraceUrl(endpoint);
  const { body, contentType } = encodeProbe(span, encoding);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...headers },
    body,
  });
  if (!response.ok) {
    const otherEncoding = encoding === 'json' ? 'protobuf' : 'json';
    throw new Error(
      `OTLP endpoint ${url} rejected the probe span: ${response.status} ${response.statusText}. ` +
        `Sent ${encoding}; if the receiver wants the other encoding, pass --otlp-encoding ${otherEncoding}.`,
    );
  }
}

/** Resolve an OTLP base endpoint without discarding vendor-specific paths. */
export function resolveOtlpTraceUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const basePath = url.pathname.replace(/\/+$/, '');
  if (!basePath.endsWith('/v1/traces')) {
    url.pathname = `${basePath}/v1/traces`;
  }
  return url.toString();
}

export interface FreshnessOptions {
  backend: TelemetryBackend;
  /** Base OTLP/HTTP URL to write the probe to, e.g. `http://localhost:4318`. */
  otlpEndpoint: string;
  /** Payload encoding. Defaults to protobuf, which every OTLP receiver accepts. */
  encoding?: OtlpEncoding;
  /** Give up after this long. Default 120s. */
  timeoutMs?: number;
  /** Gap between reads. Default 2s. */
  pollIntervalMs?: number;
  /**
   * Extra headers for the probe write — hosted OTLP endpoints need auth.
   * Defaults to whatever `OTEL_EXPORTER_OTLP_HEADERS` holds.
   */
  headers?: Record<string, string>;
  /** Injected for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  send?: (
    endpoint: string,
    span: ProbeSpan,
    headers: Record<string, string>,
    encoding: OtlpEncoding,
  ) => Promise<void>;
}

export interface FreshnessResult {
  /** Unique `service.name` the probe span was written under. */
  probeService: string;
  otlpEndpoint: string;
  encoding: OtlpEncoding;
  /** Seconds from write to first successful read, or `null` if it never showed. */
  timeToQueryableSeconds: number | null;
  timedOut: boolean;
  /** How many reads it took. */
  attempts: number;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEADLINE_REACHED = Symbol('freshness-deadline-reached');

async function beforeDeadline<T>(
  promise: Promise<T>,
  remainingMs: number,
): Promise<T | typeof DEADLINE_REACHED> {
  if (remainingMs <= 0) return DEADLINE_REACHED;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof DEADLINE_REACHED>((resolve) => {
        timer = setTimeout(() => resolve(DEADLINE_REACHED), remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Write one probe span and time how long the backend takes to serve it back.
 *
 * An empty successful read means "not yet". Read failures are surfaced because
 * authentication and configuration errors cannot become fresh by polling.
 */
export async function measureFreshness(
  options: FreshnessOptions,
): Promise<FreshnessResult> {
  const {
    backend,
    otlpEndpoint,
    encoding = 'protobuf',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    headers = otlpHeadersFromEnv(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    now = Date.now,
    sleep = defaultSleep,
    send = sendOtlpTrace,
  } = options;

  const probeService = `autotel-freshness-probe-${randomHex(6)}`;
  const startedAt = now();

  const timedOutResult = (attempts: number): FreshnessResult => ({
    probeService,
    otlpEndpoint,
    encoding,
    timeToQueryableSeconds: null,
    timedOut: true,
    attempts,
    timeoutMs,
  });

  const sent = await beforeDeadline(
    send(
      otlpEndpoint,
      buildProbeSpan(probeService, startedAt),
      headers,
      encoding,
    ),
    timeoutMs,
  );
  if (sent === DEADLINE_REACHED) return timedOutResult(0);

  let attempts = 0;
  for (;;) {
    attempts++;
    const remainingMs = timeoutMs - (now() - startedAt);
    const result = await beforeDeadline(
      backend.searchTraces({
        service: probeService,
        limit: 1,
      }),
      remainingMs,
    );
    if (result === DEADLINE_REACHED) return timedOutResult(attempts);

    const found = (result.items?.length ?? 0) > 0;

    if (found) {
      return {
        probeService,
        otlpEndpoint,
        encoding,
        timeToQueryableSeconds: (now() - startedAt) / 1000,
        timedOut: false,
        attempts,
        timeoutMs,
      };
    }

    if (now() - startedAt >= timeoutMs) {
      return timedOutResult(attempts);
    }

    await sleep(Math.min(pollIntervalMs, timeoutMs - (now() - startedAt)));
  }
}
