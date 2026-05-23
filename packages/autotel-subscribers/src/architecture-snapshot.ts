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
    const fieldPaths = extractFieldPaths(stripAutotelMeta(attrs));

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
      });
      return;
    }

    existing.observedCount += 1;
    existing.lastSeen = now;
    existing.fieldPaths = mergeUnique(existing.fieldPaths, fieldPaths);

    if (
      traceId &&
      !existing.sampleTraceIds.includes(traceId) &&
      existing.sampleTraceIds.length < this.maxSampleTraceIds
    ) {
      existing.sampleTraceIds.push(traceId);
    }

    existing.channel ??= autotelMeta.channel;
    existing.producer ??= autotelMeta.producer;
  }

  /**
   * Build the snapshot in memory. Use this in tests or when you want to
   * inspect the result before writing it. Field paths and trace IDs are
   * sorted so equal inputs always produce byte-identical snapshots.
   */
  toSnapshot(now: () => Date = () => new Date()): ArchitectureSnapshot {
    const events: Record<string, EventObservation> = {};

    const names = [...this.observations.keys()].toSorted();
    for (const name of names) {
      const obs = this.observations.get(name);
      if (!obs) continue;
      events[name] = {
        ...obs,
        fieldPaths: obs.fieldPaths.toSorted(),
        sampleTraceIds: obs.sampleTraceIds.toSorted(),
      };
    }

    return {
      spec: ARCHITECTURE_SNAPSHOT_SPEC,
      generatedAt: now().toISOString(),
      service: this.service,
      events,
    };
  }

  /**
   * Write the snapshot to disk. Creates parent directories as needed.
   * Files are written with a trailing newline so they diff cleanly in git.
   */
  async writeToFile(
    filePath: string,
    options: { now?: () => Date } = {},
  ): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const json = JSON.stringify(this.toSnapshot(options.now), null, 2);
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
};

function readAutotelMeta(attrs: Record<string, unknown>): AutotelMeta {
  const meta = attrs._autotel;
  if (!meta || typeof meta !== 'object') return {};
  const m = meta as Record<string, unknown>;
  return {
    channel: typeof m.channel === 'string' ? m.channel : undefined,
    producer: typeof m.producer === 'string' ? m.producer : undefined,
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
