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

import type {
  EventAttributes,
  EventAttributeValue,
} from 'autotel/event-subscriber';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventSubscriber, type EventPayload } from './event-subscriber-base';

/**
 * Public, versioned snapshot format. The generator and any downstream tooling
 * target this spec. Bumping the spec version is a breaking change for
 * downstream consumers, so add fields rather than rename existing ones.
 */
export const ARCHITECTURE_SNAPSHOT_SPEC =
  'autotel-architecture/v0.1.0' as const;

export type ArchitectureSnapshot = {
  spec: typeof ARCHITECTURE_SNAPSHOT_SPEC;
  generatedAt: string;
  service: string;
  /**
   * True when consumer spans were read (the subscriber's `spanProcessor` was
   * registered). Only then does an empty `observedConsumers` mean "nobody was
   * seen receiving it" rather than "nobody was watching".
   */
  consumersMeasured?: boolean;
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
  /**
   * One entry per distinct (producer, channel) pair this event was seen on,
   * with that pair's own count.
   *
   * `producer` and `channel` above are first-write-wins and `observedCount` is
   * an event-level total, so two services publishing the same event name
   * collapse into one: the second producer disappears and its observations are
   * silently credited to the first. Anything attributing counts to a specific
   * relationship must read this instead.
   */
  sources?: EventSource[];
  /**
   * Consumers seen receiving this event, measured from their `traceConsumer`
   * spans rather than declared by the producer. Present only when consumer
   * spans were read; see {@link ArchitectureSnapshot.consumersMeasured}.
   */
  observedConsumers?: ObservedConsumer[];
  /** Observed runtime types and sample primitive values per field path. */
  fieldStats?: Record<string, FieldStats>;
  /** Optional contract schema metadata carried from track() call sites. */
  schema?: {
    source: 'zod';
    jsonSchema: unknown;
    hash: string;
  };
};

/** One (producer, channel) pair an event was observed on, with its own count. */
export type EventSource = {
  producer?: string;
  channel?: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
};

/** One consumer seen receiving an event on a channel, with its own count. */
export type ObservedConsumer = {
  consumer: string;
  channel: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
};

/** A ReadableSpan as the consumer join reads one, without a hard SDK dependency. */
export interface ConsumerSpanLike {
  kind: number;
  attributes: Record<string, SpanAttributeValue>;
  links: Array<{ context: { traceId: string; spanId: string } }>;
  endTime: [number, number];
  resource?: { attributes: Record<string, SpanAttributeValue> };
}

/** What a span or resource attribute can hold once recorded. */
export type SpanAttributeValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean | null | undefined>
  | undefined;

/** The SpanProcessor shape `init({ spanProcessors })` accepts. */
export interface ConsumerSpanProcessor {
  onStart(): void;
  onEnd(span: ConsumerSpanLike): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

/** OTel `SpanKind.CONSUMER`. */
const SPAN_KIND_CONSUMER = 4;

/**
 * Producer spans remembered on each side of the producer/consumer join. Either
 * side can arrive first: `track()` payloads reach subscribers through a queue,
 * so a consumer span often ends before the event it received is recorded.
 */
const MAX_JOIN_SPANS = 10_000;
/**
 * Entries kept per producer span. One span is one publish, so more than a
 * handful means a consumer redelivering in a loop; later ones are dropped.
 */
const MAX_PER_SPAN = 16;

type Delivery = { event: string; channel?: string };
type Receipt = { consumer: string; channel: string; at: string };

/** A consumer measured receiving an event, as `onConsumerObserved` reports it. */
export type ConsumerReceipt = Receipt & { event: string };

/** Join key: the producer span a message was published from. */
const spanKey = (traceId: string, spanId: string) => `${traceId}/${spanId}`;

// Insertion-order eviction; a span evicted before its other half arrives is
// not counted.
function remember<T>(index: Map<string, T[]>, key: string, item: T): void {
  const list = index.get(key);
  if (list) {
    if (list.length < MAX_PER_SPAN) list.push(item);
    return;
  }
  if (index.size >= MAX_JOIN_SPANS) {
    const oldest = index.keys().next().value;
    if (oldest !== undefined) index.delete(oldest);
  }
  index.set(key, [item]);
}

function recordConsumer(
  observation: { observedConsumers?: ObservedConsumer[] },
  { consumer, channel, at }: Receipt,
): void {
  const consumers = (observation.observedConsumers ??= []);
  const existing = consumers.find(
    (entry) => entry.consumer === consumer && entry.channel === channel,
  );
  if (existing) {
    existing.count += 1;
    if (at < existing.firstSeen) existing.firstSeen = at;
    if (at > existing.lastSeen) existing.lastSeen = at;
    return;
  }
  consumers.push({ consumer, channel, count: 1, firstSeen: at, lastSeen: at });
}

function hrTimeToIso([seconds, nanos]: [number, number]): string {
  return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
}

/**
 * Order two (producer, channel) pairs, comparing the fields rather than a
 * joined key.
 *
 * Both come from caller-supplied `_autotel` metadata and may contain any
 * character, so joining them with a separator is ambiguous: `('A|B', 'C')` and
 * `('A', 'B|C')` produce the same string and would merge into one source.
 */
function compareSources(a: EventSource, b: EventSource): number {
  return (
    (a.producer ?? '').localeCompare(b.producer ?? '') ||
    (a.channel ?? '').localeCompare(b.channel ?? '')
  );
}

function recordSource(
  observation: { sources?: EventSource[] },
  producer: string | undefined,
  channel: string | undefined,
  now: string,
): void {
  const sources = (observation.sources ??= []);
  const existing = sources.find(
    (source) => source.producer === producer && source.channel === channel,
  );
  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    return;
  }
  sources.push({
    ...(producer !== undefined && { producer }),
    ...(channel !== undefined && { channel }),
    count: 1,
    firstSeen: now,
    lastSeen: now,
  });
}

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
  /**
   * Called each time a consumer is measured receiving an event, so a live
   * view can draw the exact consumer edge rather than guess from the producer.
   */
  onConsumerObserved?: (receipt: ConsumerReceipt) => void;
}

const DEFAULT_MAX_SAMPLES = 3;

export class ArchitectureSnapshotSubscriber extends EventSubscriber {
  readonly name = 'ArchitectureSnapshotSubscriber';

  private readonly service: string;
  private readonly maxSampleTraceIds: number;
  private readonly onConsumerObserved?: (receipt: ConsumerReceipt) => void;
  private readonly observations = new Map<string, EventObservation>();
  private readonly deliveries = new Map<string, Delivery[]>();
  private readonly receipts = new Map<string, Receipt[]>();
  private consumersMeasured = false;
  private processor?: ConsumerSpanProcessor;

  constructor(config: ArchitectureSnapshotConfig) {
    super();
    this.service = config.service;
    this.maxSampleTraceIds = config.maxSampleTraceIds ?? DEFAULT_MAX_SAMPLES;
    this.onConsumerObserved = config.onConsumerObserved;
  }

  /**
   * Register with `init({ spanProcessors: [snapshot.spanProcessor] })` to
   * measure consumption: a `traceConsumer` span whose producer link points at
   * the span an event was tracked in, on the same channel, counts as that
   * consumer receiving that event. So `track()` the event inside the
   * `traceProducer` that publishes it: one producer span is one message, and an
   * event tracked anywhere else is never credited to a consumer. Consumers need
   * `headersFrom` so the link exists, and
   * `init({ events: { includeTraceContext: true } })` so tracked events carry
   * the span the link is matched against. The consumer is
   * `messaging.consumer.group.name`, falling back to the span's `service.name`.
   */
  get spanProcessor(): ConsumerSpanProcessor {
    this.consumersMeasured = true;
    this.processor ??= {
      onStart: () => {},
      // Runs inside span.end(): nothing in the join may fail the application's
      // work or starve the processors after this one.
      onEnd: (span) => {
        try {
          this.recordConsumerSpan(span);
        } catch (error) {
          console.error(`[${this.name}] consumer span not recorded:`, error);
        }
      },
      shutdown: async () => {},
      forceFlush: async () => {},
    };
    return this.processor;
  }

  private recordConsumerSpan(span: ConsumerSpanLike): void {
    if (span.kind !== SPAN_KIND_CONSUMER) return;
    const channel = span.attributes['messaging.destination.name'];
    const consumer =
      span.attributes['messaging.consumer.group.name'] ??
      span.resource?.attributes['service.name'];
    if (typeof channel !== 'string' || typeof consumer !== 'string') return;

    const receipt = { consumer, channel, at: hrTimeToIso(span.endTime) };
    const keys = new Set(
      span.links.map((l) => spanKey(l.context.traceId, l.context.spanId)),
    );
    for (const key of keys) {
      for (const delivery of this.deliveries.get(key) ?? []) {
        this.credit(delivery, receipt);
      }
      remember(this.receipts, key, receipt);
    }
  }

  private recordDelivery(key: string, delivery: Delivery): void {
    for (const receipt of this.receipts.get(key) ?? []) {
      this.credit(delivery, receipt);
    }
    remember(this.deliveries, key, delivery);
  }

  // Each side matches only what the other side already holds, so every
  // (delivery, receipt) pair is credited exactly once whichever arrives first.
  private credit(delivery: Delivery, receipt: Receipt): void {
    if (delivery.channel !== receipt.channel) return;
    const observation = this.observations.get(delivery.event);
    if (!observation) return;
    recordConsumer(observation, receipt);
    // Caught here as well as in onEnd so a throwing listener cannot stop the
    // remaining pairs in this loop from being credited.
    try {
      this.onConsumerObserved?.({ ...receipt, event: delivery.event });
    } catch (error) {
      console.error(`[${this.name}] onConsumerObserved failed:`, error);
    }
  }

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    // Only `track()` events feed the architecture snapshot. Funnels, outcomes,
    // and value metrics belong to product analytics, not the architecture model.
    if (payload.type !== 'event') return;

    const existing = this.observations.get(payload.name);
    const now = payload.timestamp;
    const traceId = payload.autotel?.trace_id;
    const spanId = payload.autotel?.span_id;
    const deliveryKey =
      traceId && spanId ? spanKey(traceId, spanId) : undefined;
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
        sources: [
          {
            ...(autotelMeta.producer !== undefined && {
              producer: autotelMeta.producer,
            }),
            ...(autotelMeta.channel !== undefined && {
              channel: autotelMeta.channel,
            }),
            count: 1,
            firstSeen: now,
            lastSeen: now,
          },
        ],
      });
      if (deliveryKey) {
        this.recordDelivery(deliveryKey, {
          event: payload.name,
          channel: autotelMeta.channel,
        });
      }
      return;
    }

    existing.observedCount += 1;
    existing.lastSeen = now;
    existing.fieldPaths = mergeUnique(existing.fieldPaths, fieldPaths);
    existing.fieldStats = mergeFieldStats(
      existing.fieldStats ?? {},
      fieldStats,
    );

    if (
      traceId &&
      !existing.sampleTraceIds.includes(traceId) &&
      existing.sampleTraceIds.length < this.maxSampleTraceIds
    ) {
      existing.sampleTraceIds.push(traceId);
    }

    existing.channel ??= autotelMeta.channel;
    existing.producer ??= autotelMeta.producer;
    recordSource(existing, autotelMeta.producer, autotelMeta.channel, now);
    existing.consumers = mergeUnique(
      existing.consumers ?? [],
      autotelMeta.consumers ?? [],
    );
    existing.schema ??= payload.schema
      ? {
          source: payload.schema.source,
          jsonSchema: payload.schema.jsonSchema,
          hash: payload.schema.hash,
        }
      : undefined;
    if (deliveryKey) {
      this.recordDelivery(deliveryKey, {
        event: payload.name,
        channel: autotelMeta.channel,
      });
    }
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
        ...(obs.sources && {
          sources: obs.sources
            .map((source) => ({
              ...source,
              firstSeen: freezeTimestamps ?? source.firstSeen,
              lastSeen: freezeTimestamps ?? source.lastSeen,
            }))
            .toSorted(compareSources),
        }),
        ...(obs.observedConsumers && {
          observedConsumers: obs.observedConsumers
            .map((entry) => ({
              ...entry,
              firstSeen: freezeTimestamps ?? entry.firstSeen,
              lastSeen: freezeTimestamps ?? entry.lastSeen,
            }))
            .toSorted(
              (a, b) =>
                a.consumer.localeCompare(b.consumer) ||
                a.channel.localeCompare(b.channel),
            ),
        }),
      };
    }

    return {
      spec: ARCHITECTURE_SNAPSHOT_SPEC,
      generatedAt: freezeTimestamps ?? now().toISOString(),
      service: this.service,
      ...(this.consumersMeasured && { consumersMeasured: true }),
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
    this.deliveries.clear();
    this.receipts.clear();
  }
}

type AutotelMeta = {
  channel?: string;
  producer?: string;
  consumers?: string[];
};

function readAutotelMeta(attrs: EventAttributes): AutotelMeta {
  const meta = attrs._autotel;
  if (!meta || typeof meta !== 'object') return {};
  // SAFETY: the guard above established `meta` is a non-null object; every
  // field read below is checked for its own type before it is used.
  const m = meta as Record<string, EventAttributeValue>;
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

function stripAutotelMeta(attrs: EventAttributes): EventAttributes {
  const out: EventAttributes = {};
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

function extractFieldStats(
  value: unknown,
  prefix = '',
): Record<string, FieldStats> {
  const out = new Map<
    string,
    { types: Set<string>; sampleValues: Set<string | number | boolean | null> }
  >();
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
  out: Map<
    string,
    { types: Set<string>; sampleValues: Set<string | number | boolean | null> }
  >,
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
  out: Map<
    string,
    { types: Set<string>; sampleValues: Set<string | number | boolean | null> }
  >,
): void {
  const existing = out.get(path) ?? {
    types: new Set<string>(),
    sampleValues: new Set<string | number | boolean | null>(),
  };
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
  const merged = new Map(Object.entries(a));
  for (const [path, bs] of Object.entries(b)) {
    const prev = merged.get(path);
    if (!prev) {
      merged.set(path, bs);
      continue;
    }
    const types = new Set([...prev.types, ...bs.types]);
    const sampleValues = new Set([...prev.sampleValues, ...bs.sampleValues]);
    merged.set(path, {
      types: [...types].toSorted(),
      sampleValues: [...sampleValues]
        .toSorted(comparePrimitiveValues)
        .slice(0, 20),
    });
  }
  return Object.fromEntries(merged);
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
