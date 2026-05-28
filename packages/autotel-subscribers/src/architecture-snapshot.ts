/**
 * ArchitectureSnapshotSubscriber
 *
 * Captures `track()` events into an in-memory architecture snapshot, then
 * writes it to disk. The snapshot is the input to `autotel-eventcatalog`'s
 * generator and is designed to be deterministic, reviewable, and committable.
 *
 * v0 scope: capture event names, observation counts, first/last-seen, sample
 * trace IDs, and the dotted field paths present in payloads. Producer /
 * consumer / channel attribution is read from a small `_autotel.*` convention
 * inside event attributes — that convention is documented in
 * `apps/example-eventcatalog`.
 *
 * @example
 * ```typescript
 * import { init, track } from 'autotel';
 * import { ArchitectureSnapshotSubscriber } from 'autotel-subscribers/architecture';
 *
 * const snapshot = new ArchitectureSnapshotSubscriber({ service: 'orders' });
 *
 * init({
 *   service: 'orders',
 *   subscribers: [snapshot],
 * });
 *
 * // ... exercise the system (run integration tests, hit endpoints, etc.) ...
 *
 * await snapshot.writeToFile('./.autotel/snapshot.json');
 * ```
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { EventSubscriber, type EventPayload } from './event-subscriber-base';

/**
 * Public, versioned snapshot format. The generator and any downstream tooling
 * target this spec. Bumping the spec version is a breaking change for
 * downstream consumers, so add fields rather than rename existing ones.
 */
export const ARCHITECTURE_SNAPSHOT_SPEC = 'autotel-architecture/v0.1.0' as const;

export type ArchitectureSnapshot = {
  spec: typeof ARCHITECTURE_SNAPSHOT_SPEC;
  generatedAt: string;
  service: string;
  events: Record<string, EventObservation>;
};

export type EventObservation = {
  name: string;
  observedCount: number;
  firstSeen: string;
  lastSeen: string;
  /** Dotted field paths observed in any payload (e.g. `items[].sku`). */
  fieldPaths: string[];
  /** Up to 3 trace IDs for click-through from the catalog into the backend. */
  sampleTraceIds: string[];
  /** Channel the event was published on, if the caller provided `_autotel.channel`. */
  channel?: string;
  /** Service that produced the event, if not the snapshot's own service. */
  producer?: string;
  /** Services known to consume this event (optional metadata from _autotel.consumers). */
  consumers?: string[];
  /** Observed runtime types and sample primitive values per field path. */
  fieldStats?: Record<string, FieldStats>;
  /** Optional contract schema metadata carried from track() call sites. */
  schema?: {
    source: 'zod';
    jsonSchema: unknown;
    hash: string;
  };
};

export type FieldStats = {
  /** Runtime types observed for this field path (e.g. string, number). */
  types: string[];
  /** Small set of observed primitive values (for enum/value drift checks). */
  sampleValues: Array<string | number | boolean | null>;
};

export interface ArchitectureSnapshotConfig {
  /** Service identifier that appears in the snapshot header. */
  service: string;
  /** Maximum number of trace IDs to retain per event (default 3). */
  maxSampleTraceIds?: number;
}

const DEFAULT_MAX_SAMPLES = 3;

export class ArchitectureSnapshotSubscriber extends EventSubscriber {
  readonly name = 'ArchitectureSnapshotSubscriber';

  private readonly service: string;
  private readonly maxSampleTraceIds: number;
  private readonly observations = new Map<string, EventObservation>();

  constructor(config: ArchitectureSnapshotConfig) {
    super();
    this.service = config.service;
    this.maxSampleTraceIds = config.maxSampleTraceIds ?? DEFAULT_MAX_SAMPLES;
  }

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    // Only `track()` events feed the architecture snapshot. Funnels, outcomes,
    // and value metrics belong to product analytics, not the architecture model.
    if (payload.type !== 'event') return;

    const existing = this.observations.get(payload.name);
    const now = payload.timestamp;
    const traceId = payload.autotel?.trace_id;
    const attrs = payload.attributes ?? {};
    const autotelMeta = readAutotelMeta(attrs);
    const cleanAttrs = stripAutotelMeta(attrs);
    const fieldPaths = extractFieldPaths(cleanAttrs);
    const fieldStats = extractFieldStats(cleanAttrs);

    if (!existing) {
      this.observations.set(payload.name, {
        name: payload.name,
        observedCount: 1,
        firstSeen: now,
        lastSeen: now,
        fieldPaths,
        sampleTraceIds: traceId ? [traceId] : [],
        channel: autotelMeta.channel,
        producer: autotelMeta.producer,
        consumers: autotelMeta.consumers,
        fieldStats,
        schema: payload.schema
          ? {
              source: payload.schema.source,
              jsonSchema: payload.schema.jsonSchema,
              hash: payload.schema.hash,
            }
          : undefined,
      });
      return;
    }

    existing.observedCount += 1;
    existing.lastSeen = now;
    existing.fieldPaths = mergeUnique(existing.fieldPaths, fieldPaths);
    existing.fieldStats = mergeFieldStats(existing.fieldStats ?? {}, fieldStats);

    if (
      traceId &&
      !existing.sampleTraceIds.includes(traceId) &&
      existing.sampleTraceIds.length < this.maxSampleTraceIds
    ) {
      existing.sampleTraceIds.push(traceId);
    }

    existing.channel ??= autotelMeta.channel;
    existing.producer ??= autotelMeta.producer;
    existing.consumers = mergeUnique(existing.consumers ?? [], autotelMeta.consumers ?? []);
    existing.schema ??= payload.schema
      ? {
          source: payload.schema.source,
          jsonSchema: payload.schema.jsonSchema,
          hash: payload.schema.hash,
        }
      : undefined;
  }

  /**
   * Build the snapshot in memory. Use this in tests or when you want to
   * inspect the result before writing it. Field paths and trace IDs are
   * sorted so equal inputs always produce byte-identical snapshots.
   *
   * @param options.now Clock used for the snapshot's `generatedAt` field.
   * @param options.freezeTimestamps If supplied, every timestamp in the
   *   output (`generatedAt`, and each event's `firstSeen` / `lastSeen`)
   *   is replaced with this value. Use when writing a snapshot intended
   *   to be committed to a repo as a stable artifact — production code
   *   should not pass this.
   */
  toSnapshot(
    options: { now?: () => Date; freezeTimestamps?: string } = {},
  ): ArchitectureSnapshot {
    const { now = () => new Date(), freezeTimestamps } = options;

    const events: Record<string, EventObservation> = {};

    const names = [...this.observations.keys()].toSorted();
    for (const name of names) {
      const obs = this.observations.get(name);
      if (!obs) continue;
      events[name] = {
        ...obs,
        firstSeen: freezeTimestamps ?? obs.firstSeen,
        lastSeen: freezeTimestamps ?? obs.lastSeen,
        fieldPaths: obs.fieldPaths.toSorted(),
        sampleTraceIds: obs.sampleTraceIds.toSorted(),
        fieldStats: sortFieldStats(obs.fieldStats),
      };
    }

    return {
      spec: ARCHITECTURE_SNAPSHOT_SPEC,
      generatedAt: freezeTimestamps ?? now().toISOString(),
      service: this.service,
      events,
    };
  }

  /**
   * Write the snapshot to disk. Creates parent directories as needed.
   * Files are written with a trailing newline so they diff cleanly in git.
   *
   * See {@link toSnapshot} for option semantics, including `freezeTimestamps`
   * for byte-stable committed artifacts.
   */
  async writeToFile(
    filePath: string,
    options: { now?: () => Date; freezeTimestamps?: string } = {},
  ): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const json = JSON.stringify(this.toSnapshot(options), null, 2);
    await fs.writeFile(filePath, json + '\n', 'utf8');
  }

  /** Reset all accumulated state. Useful between test cases. */
  reset(): void {
    this.observations.clear();
  }
}

type AutotelMeta = {
  channel?: string;
  producer?: string;
  consumers?: string[];
};

function readAutotelMeta(attrs: Record<string, unknown>): AutotelMeta {
  const meta = attrs._autotel;
  if (!meta || typeof meta !== 'object') return {};
  const m = meta as Record<string, unknown>;
  return {
    channel: typeof m.channel === 'string' ? m.channel : undefined,
    producer: typeof m.producer === 'string' ? m.producer : undefined,
    consumers: Array.isArray(m.consumers)
      ? m.consumers.filter((v): v is string => typeof v === 'string').toSorted()
      : undefined,
  };
}

/**
 * Top-level attribute keys that autotel injects automatically (correlation
 * context, baggage, service metadata). These describe the trace, not the
 * event payload, so they don't belong in the captured field paths.
 */
const AUTOTEL_INJECTED_KEYS = new Set([
  '_autotel',
  'traceId',
  'trace_id',
  'spanId',
  'span_id',
  'parentSpanId',
  'parent_span_id',
  'correlationId',
  'correlation_id',
  'service',
  'service.name',
]);

function stripAutotelMeta(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (AUTOTEL_INJECTED_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Walk a JSON-like value and produce a sorted list of dotted field paths.
 * Arrays collapse with `[]`, so `items: [{ sku: 'x' }]` yields `items[].sku`.
 */
export function extractFieldPaths(value: unknown, prefix = ''): string[] {
  const paths = new Set<string>();
  walk(value, prefix, paths);
  return [...paths].toSorted();
}

function walk(value: unknown, prefix: string, out: Set<string>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    const arrayPrefix = prefix + '[]';
    for (const item of value) walk(item, arrayPrefix, out);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      out.add(path);
      walk(v, path, out);
    }
    return;
  }
  // Primitives don't add new paths beyond what their key already added.
}

function mergeUnique(a: string[], b: string[]): string[] {
  if (b.length === 0) return a;
  const set = new Set(a);
  for (const v of b) set.add(v);
  return [...set];
}

function extractFieldStats(value: unknown, prefix = ''): Record<string, FieldStats> {
  const out = new Map<string, { types: Set<string>; sampleValues: Set<string | number | boolean | null> }>();
  walkFieldStats(value, prefix, out);
  const obj: Record<string, FieldStats> = {};
  for (const [path, stats] of out) {
    obj[path] = {
      types: [...stats.types].toSorted(),
      sampleValues: [...stats.sampleValues].toSorted(comparePrimitiveValues),
    };
  }
  return obj;
}

function walkFieldStats(
  value: unknown,
  prefix: string,
  out: Map<string, { types: Set<string>; sampleValues: Set<string | number | boolean | null> }>,
): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    const arrayPrefix = prefix + '[]';
    for (const item of value) walkFieldStats(item, arrayPrefix, out);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      addPathValue(path, v, out);
      walkFieldStats(v, path, out);
    }
  }
}

function addPathValue(
  path: string,
  value: unknown,
  out: Map<string, { types: Set<string>; sampleValues: Set<string | number | boolean | null> }>,
): void {
  const existing = out.get(path) ?? { types: new Set<string>(), sampleValues: new Set<string | number | boolean | null>() };
  const t = classifyValueType(value);
  existing.types.add(t);
  if (
    (value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean') &&
    existing.sampleValues.size < 20
  ) {
    existing.sampleValues.add(value);
  }
  out.set(path, existing);
}

function classifyValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function mergeFieldStats(
  a: Record<string, FieldStats>,
  b: Record<string, FieldStats>,
): Record<string, FieldStats> {
  const merged: Record<string, FieldStats> = { ...a };
  for (const [path, bs] of Object.entries(b)) {
    const prev = merged[path];
    if (!prev) {
      merged[path] = bs;
      continue;
    }
    const types = new Set([...prev.types, ...bs.types]);
    const sampleValues = new Set([...prev.sampleValues, ...bs.sampleValues]);
    merged[path] = {
      types: [...types].toSorted(),
      sampleValues: [...sampleValues]
        .toSorted(comparePrimitiveValues)
        .slice(0, 20),
    };
  }
  return merged;
}

function sortFieldStats(
  stats: Record<string, FieldStats> | undefined,
): Record<string, FieldStats> | undefined {
  if (!stats) return undefined;
  const out: Record<string, FieldStats> = {};
  for (const path of Object.keys(stats).toSorted()) {
    out[path] = {
      types: [...stats[path].types].toSorted(),
      sampleValues: [...stats[path].sampleValues].toSorted(
        comparePrimitiveValues,
      ),
    };
  }
  return out;
}

function comparePrimitiveValues(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
): number {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa.localeCompare(sb);
}
