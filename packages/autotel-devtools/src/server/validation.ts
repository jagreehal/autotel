// src/server/validation.ts
//
// Live semantic-convention validation: replay the telemetry devtools holds into
// `weaver registry live-check` and report what upstream semconv says about it
// (deprecated attributes, unknown names, wrong types).
//
// How weaver is driven:
//  - weaver takes OTLP over gRPC only: `registry live-check --format jsonl
//    --otlp-grpc-port <p> --admin-port <a> --inactivity-timeout 0`.
//  - It prints one JSON line per entity (`{span|metric|log|resource: {...}}`)
//    whose `live_check_result.all_advice[]` holds `{id, level, message,
//    context, signal_type, signal_name}`, and a final stats line on stop.
//  - `GET <admin>/health` says it is listening; `POST <admin>/stop` makes it
//    flush the report and exit (exit 1 after a graceful stop is normal).
//
// weaver is optional and never bundled: absent, every call reports
// `unavailable` with an install hint. It resolves the upstream registry from
// GitHub on each run, so the first run needs network.
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';
import { Client, credentials } from '@grpc/grpc-js';
import { encodeOtlpRequest, type OtlpJson } from './otlp-proto';

export type OtlpSignal = 'traces' | 'logs' | 'metrics';
export type ValidationLevel = 'violation' | 'improvement' | 'information';

export interface ValidationFinding {
  level: ValidationLevel;
  /** weaver's advice id, e.g. `deprecated`, `missing_attribute`. */
  id: string;
  message: string;
  /** The attribute the advice is about, when it names one. */
  attribute?: string;
  /** `span`, `metric`, `log`, `resource`, `span_event`, … */
  signal: string;
  /** Span/metric name the advice was raised on. */
  signalName?: string;
  /** Entities that drew this exact advice. */
  count: number;
}

export type ValidationResult =
  | { status: 'unavailable'; reason: string; install: string }
  | { status: 'idle'; message: string }
  | { status: 'running'; startedAt: number }
  | {
      status: 'ready';
      startedAt: number;
      completedAt: number;
      /** New telemetry arrived after this run started. */
      stale: boolean;
      /** Entities weaver checked, and how many drew no advice. */
      entities: number;
      noAdvice: number;
      counts: Record<ValidationLevel, number>;
      findings: ValidationFinding[];
      truncated: boolean;
    }
  | {
      status: 'error';
      startedAt: number;
      error: string;
      stale: boolean;
    };

const INSTALL_HINT =
  'Install weaver (https://github.com/open-telemetry/weaver/releases) and put it on PATH, or set AUTOTEL_WEAVER_BIN.';
const RUN_TIMEOUT_MS = 60_000;
const MAX_FINDINGS = 500;
// The newest batches per signal, as received. A batch dropped from this window
// is not validated even while devtools still shows its data.
const MAX_BATCHES = 200;
// Held apart from the store's own caps, so it gets one of its own.
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 2 * 1024 * 1024;

/** `AUTOTEL_WEAVER_BIN`, else the first executable `weaver` on PATH. */
export function resolveWeaver(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const custom = env.AUTOTEL_WEAVER_BIN?.trim();
  if (custom) return custom;
  const names =
    process.platform === 'win32' ? ['weaver.exe', 'weaver'] : ['weaver'];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

// ── jsonl → findings ──────────────────────────────────────────────────────

type Json = string | number | boolean | null | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}
const isObject = (value: Json | undefined): value is JsonObject =>
  value instanceof Object && !Array.isArray(value);
const text = (value: Json | undefined) =>
  value === undefined || value === null || value instanceof Object
    ? undefined
    : String(value);
const LEVELS: readonly ValidationLevel[] = [
  'violation',
  'improvement',
  'information',
];
const levelOf = (value: string | undefined) =>
  LEVELS.find((level) => level === value?.toLowerCase());

/** Every `live_check_result.all_advice` entry anywhere under `value`. */
function adviceIn(value: Json | undefined, out: JsonObject[]): JsonObject[] {
  if (Array.isArray(value)) {
    for (const item of value) adviceIn(item, out);
  } else if (isObject(value)) {
    const result = value.live_check_result;
    if (isObject(result) && Array.isArray(result.all_advice))
      out.push(...result.all_advice.filter(isObject));
    for (const [key, child] of Object.entries(value))
      if (key !== 'live_check_result') adviceIn(child, out);
  }
  return out;
}

export interface WeaverReport {
  findings: ValidationFinding[];
  entities: number;
  noAdvice: number;
  truncated: boolean;
}

/**
 * Fold weaver's jsonl stdout into findings, one per distinct advice, counting
 * the entities that drew it. Banner lines and malformed JSON are skipped.
 */
export function parseWeaverOutput(stdout: string): WeaverReport {
  const byKey = new Map<string, ValidationFinding>();
  let entities = 0;
  let noAdvice = 0;
  let statsSeen = false;
  let truncated = false;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    // An entity too large to parse loses all its findings: say so.
    if (line.length > MAX_LINE_BYTES) {
      truncated = true;
      continue;
    }
    let payload: Json;
    try {
      // SAFETY: JSON.parse returns a JSON value, which is what Json describes.
      payload = JSON.parse(line) as Json;
    } catch {
      continue;
    }
    if (!isObject(payload)) continue;
    if ('total_entities' in payload || 'advice_level_counts' in payload) {
      statsSeen = true;
      entities = Number(text(payload.total_entities) ?? 0);
      noAdvice = Number(text(payload.no_advice_count) ?? 0);
      continue;
    }
    const entityType = ['span', 'metric', 'log', 'resource'].find((key) =>
      isObject(payload[key]),
    );
    if (!entityType) continue;
    const entity = payload[entityType];
    const seen = new Set<string>();
    for (const advice of adviceIn(entity, [])) {
      const level = levelOf(text(advice.level));
      const id = text(advice.id);
      const message = text(advice.message);
      if (!level || !id || !message) continue;
      const context = isObject(advice.context) ? advice.context : {};
      const attribute =
        text(context.attribute_name) ?? text(context.attribute_key);
      const signal = text(advice.signal_type) ?? entityType;
      const signalName =
        text(advice.signal_name) ??
        (isObject(entity) ? text(entity.name) : undefined);
      const key = [level, id, message, attribute, signal, signalName].join(
        '\u0000',
      );
      // One entity can repeat the same advice (e.g. on each event); it counts once.
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else if (byKey.size < MAX_FINDINGS) {
        const finding: ValidationFinding = {
          level,
          id,
          message,
          signal,
          count: 1,
        };
        if (attribute) finding.attribute = attribute;
        if (signalName) finding.signalName = signalName;
        byKey.set(key, finding);
      } else truncated = true;
    }
    if (!statsSeen) entities += 1;
  }
  const findings = [...byKey.values()].sort(
    (a, b) =>
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || b.count - a.count,
  );
  return { findings, entities, noAdvice, truncated };
}

// ── running weaver ────────────────────────────────────────────────────────

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address instanceof Object ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('weaver did not start listening in time');
}

const SERVICE = {
  traces: '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
  logs: '/opentelemetry.proto.collector.logs.v1.LogsService/Export',
  metrics: '/opentelemetry.proto.collector.metrics.v1.MetricsService/Export',
} satisfies Record<OtlpSignal, string>;

/** Send OTLP batches to a gRPC receiver, one Export call per batch. */
export async function exportOverGrpc(
  address: string,
  batches: ReadonlyArray<readonly [OtlpSignal, OtlpJson]>,
): Promise<void> {
  const client = new Client(address, credentials.createInsecure());
  try {
    for (const [signal, request] of batches) {
      const body = Buffer.from(encodeOtlpRequest(signal, request));
      await new Promise<void>((resolve, reject) => {
        client.makeUnaryRequest(
          SERVICE[signal],
          (value: Buffer) => value,
          (value: Buffer) => value,
          body,
          { deadline: Date.now() + 5000 },
          (error) => (error ? reject(error) : resolve()),
        );
      });
    }
  } finally {
    client.close();
  }
}

export interface WeaverRun {
  stdout: string;
  /** stdout passed the in-memory cap, so later findings were never read. */
  outputTruncated: boolean;
}

/**
 * Run weaver once over `batches` and return its stdout. Only a run weaver
 * finished on our `/stop` counts: it exits 0, or 1 when it found violations.
 * A signal (our timeout, a crash) or any other code means the report is a
 * fragment, and a fragment must never read as a clean result.
 */
async function runWeaver(
  bin: string,
  batches: ReadonlyArray<readonly [OtlpSignal, OtlpJson]>,
): Promise<WeaverRun> {
  const [otlpPort, adminPort] = [await freePort(), await freePort()];
  const child = spawn(
    bin,
    [
      'registry',
      'live-check',
      '--format',
      'jsonl',
      '--otlp-grpc-port',
      String(otlpPort),
      '--admin-port',
      String(adminPort),
      '--inactivity-timeout',
      '0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  let outputTruncated = false;
  // The report is held in memory up to the cap; past it, `truncated` says so.
  const cap = 32 * 1024 * 1024;
  child.stdout.on('data', (chunk: Buffer) => {
    if (stdout.length < cap) stdout += chunk.toString('utf8');
    else outputTruncated = true;
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2000);
  });
  // `close`, not `exit`: it fires only once stdout and stderr have drained,
  // so the last lines of the report are in `stdout` before we parse it.
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const admin = `http://127.0.0.1:${adminPort}`;
  const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS);
  try {
    await Promise.race([
      waitForHealth(`${admin}/health`, Date.now() + 30_000),
      exited.then(() => {
        throw new Error(
          `weaver exited before listening: ${stderr.trim() || 'no output'}`,
        );
      }),
    ]);
    await exportOverGrpc(`127.0.0.1:${otlpPort}`, batches);
    const stopped = await fetch(`${admin}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (!stopped) child.kill('SIGTERM');
    const { code, signal } = await exited;
    if (!stopped || signal !== null || (code !== 0 && code !== 1)) {
      const how = signal ? `was killed (${signal})` : `exited ${code}`;
      throw new Error(
        `weaver ${how} before finishing its report${
          stopped ? '' : '; it did not accept /stop'
        }${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
      );
    }
    return { stdout, outputTruncated };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

// ── state ─────────────────────────────────────────────────────────────────

export interface Validator {
  /** Record an ingested OTLP request (JSON-mapped), for the next run. */
  capture(signal: OtlpSignal, request: OtlpJson): void;
  /** Latest result, with staleness worked out now. */
  get(): ValidationResult;
  /** Run now (joins a run already in flight). */
  run(): Promise<ValidationResult>;
  /** Drop captured batches: one signal's, or all of them. */
  clear(signal?: OtlpSignal): void;
}

export function createValidator(
  options: {
    resolve?: () => string | undefined;
    run?: typeof runWeaver;
    now?: () => number;
  } = {},
): Validator {
  const resolveBin = options.resolve ?? (() => resolveWeaver());
  const execute = options.run ?? runWeaver;
  const now = options.now ?? Date.now;
  let batches: Array<{ signal: OtlpSignal; request: OtlpJson; bytes: number }> =
    [];
  let bytes = 0;
  // Resolved on first capture, and again on every get/run, so installing
  // weaver later starts capture without a restart.
  let bin: string | undefined | null = null;
  const binary = (): string | undefined => {
    bin = resolveBin();
    return bin;
  };
  let lastIngestAt = 0;
  let latest: ValidationResult = {
    status: 'idle',
    message:
      'No validation has run yet. POST /api/validation/run to start one.',
  };
  let inFlight: Promise<ValidationResult> | undefined;

  const unavailable = (): ValidationResult | undefined =>
    binary()
      ? undefined
      : {
          status: 'unavailable',
          reason: 'weaver was not found on PATH',
          install: INSTALL_HINT,
        };

  const withStaleness = (result: ValidationResult): ValidationResult =>
    result.status === 'ready' || result.status === 'error'
      ? { ...result, stale: lastIngestAt > result.startedAt }
      : result;

  return {
    capture(signal, request) {
      lastIngestAt = now();
      // Nothing to validate with: keep nothing.
      if ((bin === null ? binary() : bin) === undefined) return;
      const size = JSON.stringify(request).length;
      if (size > MAX_BYTES) return;
      batches.push({ signal, request, bytes: size });
      bytes += size;
      const evict = (batch: (typeof batches)[number]) => {
        batches.splice(batches.indexOf(batch), 1);
        bytes -= batch.bytes;
      };
      const perSignal = batches.filter((batch) => batch.signal === signal);
      if (perSignal.length > MAX_BATCHES) evict(perSignal[0]!);
      while (bytes > MAX_BYTES) evict(batches[0]!);
    },
    get() {
      return unavailable() ?? withStaleness(latest);
    },
    run() {
      const missing = unavailable();
      if (missing) return Promise.resolve(missing);
      if (inFlight) return inFlight;
      const startedAt = now();
      const snapshot = batches.map(
        ({ signal, request }) => [signal, request] as const,
      );
      latest = { status: 'running', startedAt };
      inFlight = execute(bin!, snapshot)
        .then(({ stdout, outputTruncated }): ValidationResult => {
          const report = parseWeaverOutput(stdout);
          const counts = { violation: 0, improvement: 0, information: 0 };
          for (const finding of report.findings)
            counts[finding.level] += finding.count;
          return {
            status: 'ready',
            startedAt,
            completedAt: now(),
            stale: false,
            entities: report.entities,
            noAdvice: report.noAdvice,
            counts,
            findings: report.findings,
            truncated: report.truncated || outputTruncated,
          };
        })
        .catch((error: Error): ValidationResult => ({
          status: 'error',
          startedAt,
          error: error instanceof Error ? error.message : String(error),
          stale: false,
        }))
        .then((result) => {
          latest = result;
          inFlight = undefined;
          return withStaleness(result);
        });
      return inFlight;
    },
    clear(signal) {
      batches = signal ? batches.filter((b) => b.signal !== signal) : [];
      bytes = batches.reduce((total, batch) => total + batch.bytes, 0);
      lastIngestAt = now();
    },
  };
}
