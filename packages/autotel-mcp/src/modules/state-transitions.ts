import type { TelemetryBackend } from '../backends/telemetry';
import type { LogRecord, MetricSeries, TagValue } from '../types';
import { resolveTimeRange } from './time-range';

const METRIC = 'autotel.state.transitions';
/** The name Prometheus stores the counter under, by OTLP's translation rules. */
const PROMETHEUS_METRIC = 'autotel_state_transitions_total';
const LOG_EVENT = 'state.transition';
const SPEC = 'autotel-transitions/v0.1.0';

const GROUP_BY = [
  'service',
  'state.entity',
  'state.field',
  'state.from',
  'state.to',
  'state.via',
];

/** Above any real series count; backends otherwise default to 20 or 100. */
const SERIES_LIMIT = 50_000;
/** The most a log search page holds on any backend here (Datadog's cap). */
const HISTORY_LIMIT = 1000;

export interface StateTransitionsInput {
  entity?: string;
  field?: string;
  serviceName?: string;
  /** A state name, not a time. */
  from?: string;
  /** A state name, not a time. */
  to?: string;
  lookbackMinutes?: number;
}

export interface EntityHistoryInput {
  entity: string;
  id: string;
  field?: string;
  lookbackMinutes?: number;
}

/** The shape shared with consumers of the spec. Changing it is a spec bump. */
export interface StateTransitionsDocument {
  spec: typeof SPEC;
  window: { from: string; to: string };
  source: string;
  instrumented: Array<{ entity: string; field: string }>;
  transitions: Array<{
    entity: string;
    field: string;
    from: string;
    to: string;
    via: string;
    service: string;
    count: number;
  }>;
}

function isoWindow(lookbackMinutes: number) {
  const { startTimeUnixMs, endTimeUnixMs } = resolveTimeRange({
    lookbackMinutes,
  });
  // SAFETY: resolveTimeRange returns both bounds whenever a lookback is given.
  const [start, end] = [startTimeUnixMs!, endTimeUnixMs!];
  return {
    startTimeUnixMs: start,
    endTimeUnixMs: end,
    iso: {
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
    },
  };
}

/**
 * An attribute by its OTel name, or as Prometheus spells it
 * (`state.entity` becomes the label `state_entity`).
 */
function attribute(
  attributes: Record<string, TagValue> | undefined,
  name: string,
): string | undefined {
  const value = attributes?.[name] ?? attributes?.[name.replaceAll('.', '_')];
  return value === undefined ? undefined : String(value);
}

/**
 * Transitions in the window. A delta point is an increment. A cumulative point
 * is a running total, so the count is what it gained over its last value before
 * the window. With no earlier point, a series whose start time falls before the
 * window counts up from its first value, since the reader only just began
 * seeing it. Otherwise it began inside the window and its first value is all
 * new: rare transitions depend on this, since a counter that moved once and
 * stayed there never gains again. A drop means the process restarted and began
 * again from zero.
 */
function windowCount(
  { points, temporality }: MetricSeries,
  windowStartMs: number,
): number {
  const inside = points.filter((p) => p.timestampUnixMs >= windowStartMs);
  if (temporality === 'delta') {
    return inside.reduce((sum, point) => sum + point.value, 0);
  }
  const [first] = inside;
  const startedEarlier =
    (first?.startTimeUnixMs ?? windowStartMs) < windowStartMs;
  let previous =
    points.findLast((p) => p.timestampUnixMs < windowStartMs)?.value ??
    (startedEarlier ? first.value : 0);
  let count = 0;
  for (const { value } of inside) {
    count += value >= previous ? value - previous : value;
    previous = value;
  }
  return count;
}

const compareKeys = <T extends object>(a: T, b: T): number =>
  JSON.stringify(Object.values(a)).localeCompare(
    JSON.stringify(Object.values(b)),
  );

export async function readStateTransitions(
  backend: TelemetryBackend,
  input: StateTransitionsInput,
): Promise<StateTransitionsDocument> {
  const window = isoWindow(input.lookbackMinutes ?? 60);
  const { startTimeUnixMs, endTimeUnixMs } = window;
  const query = {
    // Twice the window, so a cumulative series has a value to count up from.
    startTimeUnixMs: startTimeUnixMs - (endTimeUnixMs - startTimeUnixMs),
    endTimeUnixMs,
    serviceName: input.serviceName,
    limit: SERIES_LIMIT,
    groupBy: GROUP_BY,
  };
  let series = await backend.getMetricSeries(METRIC, query);
  if (series.length === 0) {
    series = await backend.getMetricSeries(PROMETHEUS_METRIC, query);
  }

  const instrumented = new Map<string, { entity: string; field: string }>();
  const transitions = new Map<
    string,
    StateTransitionsDocument['transitions'][number]
  >();

  for (const one of series) {
    if (!one.points.some((p) => p.timestampUnixMs >= startTimeUnixMs)) continue;
    const entity = attribute(one.attributes, 'state.entity');
    const field = attribute(one.attributes, 'state.field');
    const from = attribute(one.attributes, 'state.from');
    const to = attribute(one.attributes, 'state.to');
    if (!entity || !field || !from || !to) continue;
    if (input.entity && entity !== input.entity) continue;
    if (input.field && field !== input.field) continue;

    // `from` and `to` narrow the transitions only: a state filter that matches
    // nothing must still show the entity as instrumented.
    instrumented.set(JSON.stringify([entity, field]), { entity, field });
    if (input.from && from !== input.from) continue;
    if (input.to && to !== input.to) continue;

    const count = windowCount(one, startTimeUnixMs);
    if (count <= 0) continue;

    const via = attribute(one.attributes, 'state.via') ?? 'unknown';
    const service =
      attribute(one.attributes, 'service.name') ??
      attribute(one.attributes, 'service') ??
      'unknown';
    const key = JSON.stringify([entity, field, from, to, via, service]);
    const existing = transitions.get(key);
    if (existing) existing.count += count;
    else transitions.set(key, { entity, field, from, to, via, service, count });
  }

  return {
    spec: SPEC,
    window: window.iso,
    source: backend.kind,
    instrumented: [...instrumented.values()].toSorted(compareKeys),
    transitions: [...transitions.values()].toSorted((a, b) =>
      compareKeys({ ...a, count: 0 }, { ...b, count: 0 }),
    ),
  };
}

function toHistoryEntry(record: LogRecord) {
  const { attributes, serviceName, timestampUnixMs, traceId } = record;
  return {
    timestamp: new Date(timestampUnixMs).toISOString(),
    field: attribute(attributes, 'state.field'),
    from: attribute(attributes, 'state.from'),
    to: attribute(attributes, 'state.to'),
    via: attribute(attributes, 'state.via') ?? 'unknown',
    service: serviceName ?? attribute(attributes, 'service.name') ?? 'unknown',
    ...(traceId && { traceId }),
  };
}

export async function readEntityHistory(
  backend: TelemetryBackend,
  input: EntityHistoryInput,
) {
  const { entity, id, field } = input;
  const window = isoWindow(input.lookbackMinutes ?? 24 * 60);
  const wanted = {
    'state.entity': entity,
    'state.id': id,
    ...(field && { 'state.field': field }),
  };

  const result = await backend.searchLogs({
    text: LOG_EVENT,
    attributes: wanted,
    startTimeUnixMs: window.startTimeUnixMs,
    endTimeUnixMs: window.endTimeUnixMs,
    limit: HISTORY_LIMIT,
  });

  // Not every backend's search applies attribute filters.
  const history = result.items
    .filter((record) =>
      Object.entries(wanted).every(
        ([name, value]) => attribute(record.attributes, name) === value,
      ),
    )
    .toSorted((a, b) => a.timestampUnixMs - b.timestampUnixMs)
    .map(toHistoryEntry);

  const base = {
    entity,
    id,
    source: backend.kind,
    window: window.iso,
    history,
  };
  if (result.unsupported) {
    return {
      ...base,
      message:
        `The ${backend.kind} backend cannot search logs, so it has no history for ${entity} ${id}. ${result.detail ?? ''}`.trim(),
    };
  }
  if (history.length === 0) {
    return {
      ...base,
      message: `The ${backend.kind} backend has no ${LOG_EVENT} log records for ${entity} ${id} in this window. History is off by default: transition() writes these records only with history: true and an id, and only where logs are exported.`,
    };
  }
  const full = result.truncated ?? result.items.length >= HISTORY_LIMIT;
  return {
    ...base,
    ...(full && {
      hint: `Showing the newest ${HISTORY_LIMIT} records; earlier ones exist. Narrow with field or lookbackMinutes.`,
    }),
  };
}
