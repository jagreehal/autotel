// Build a live map: the catalog's declared topology, annotated with what the
// runtime actually did.
//
// A catalog diagram draws every arrow the same way, so a relationship four
// teams believe in and one that has not carried a message since March look
// identical. The snapshot knows the difference. This module joins them into a
// single graph where every node and edge says which of the two it is.
//
// Two axes, deliberately separate:
//
//   liveness — catalog vs snapshot presence. `observed` (both), `declared-only`
//     (catalog says so, runtime never showed it) or `undocumented` (it ran, the
//     catalog never mentioned it).
//
//   evidence — whether the runtime *could* have shown it. A producer writes the
//     event, so `produces` and `publishes-to` are `observed` evidence: they come
//     from a real `track()` call. Consumption is not visible from the producer's
//     telemetry, so `consumed-by` is always `asserted`, however busy the event
//     is. Collapsing these into one axis is what lets a diagram imply it watched
//     something it only read.
//
// The renderers own how that is drawn; this module owns what is true.

import { normaliseEventId } from './diff.js';
import { suggestRenamesBetween, type RenameSuggestion } from './suggest.js';
import type { CatalogState } from './catalog.js';
import type { ArchitectureSnapshot, EventObservation } from './snapshot.js';

export const LIVE_MAP_SPEC = 'autotel-eventcatalog-map/v0.1.0';

export type MapLiveness = 'observed' | 'declared-only' | 'undocumented';
export type MapEvidence = 'observed' | 'asserted';
export type MapNodeKind = 'service' | 'event' | 'channel';
export type MapEdgeKind = 'produces' | 'publishes-to' | 'consumed-by';

export type MapNode = {
  id: string;
  kind: MapNodeKind;
  label: string;
  liveness: MapLiveness;
  /** Observations attributed to this node. 0 for anything never seen. */
  count: number;
  lastSeen?: string;
  /** Snapshot event name, on event nodes that were observed. */
  eventKey?: string;
};

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  kind: MapEdgeKind;
  evidence: MapEvidence;
  liveness: MapLiveness;
  count: number;
  /**
   * False when the count came from an event-level total rather than a
   * per-relationship one — a snapshot written before `sources` existed cannot
   * tell two producers of the same event name apart.
   */
  exactCount: boolean;
  lastSeen?: string;
  /**
   * The `track()` name that drives this edge. Live mode keys incoming events
   * by this, so an edge lights up only for the event that actually crossed it.
   */
  eventKey?: string;
};

export type LiveMapSummary = {
  observedEdges: number;
  declaredOnlyEdges: number;
  undocumentedEdges: number;
  assertedEdges: number;
  observedNodes: number;
  declaredOnlyNodes: number;
  undocumentedNodes: number;
  totalObservations: number;
};

export type LiveMap = {
  spec: typeof LIVE_MAP_SPEC;
  generatedAt: string;
  service: string;
  nodes: MapNode[];
  edges: MapEdge[];
  summary: LiveMapSummary;
  /**
   * Pairings between an undocumented event and a declared-but-unseen one.
   * A rename shows up as two findings that are really one; saying so is the
   * difference between a tool people trust and one they stop opening.
   */
  suggestions: RenameSuggestion[];
};

/** `sends`/`receives` as the catalog files actually write them. */
type Relationship = {
  id?: string;
  to?: Array<{ id?: string }>;
  from?: Array<{ id?: string }>;
};

function relationships(value: unknown): Relationship[] {
  return Array.isArray(value) ? (value as Relationship[]) : [];
}

function channelIds(entry: Relationship): string[] {
  const list = [...(entry.to ?? []), ...(entry.from ?? [])];
  return list
    .map((channel) => channel?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * One declared-or-observed relationship, before it becomes an edge.
 *
 * Evidence is matched pair-wise, which is the whole point: a catalog saying
 * `OrdersService` publishes `OrderPlaced` is not corroborated by telemetry
 * showing `PaymentService` published it. Keying on the event name alone would
 * light up the wrong producer's arrow, which is precisely the false confidence
 * this map exists to remove.
 */
type Relation = {
  id: string;
  kind: MapEdgeKind;
  source: string;
  target: string;
  /** The catalog declares this exact relationship. */
  declared: boolean;
  /** Telemetry corroborates this exact relationship. */
  observed: boolean;
  count: number;
  /**
   * False when `count` came from an event-level total rather than a
   * per-relationship one, so a renderer can avoid printing it as exact.
   */
  exactCount: boolean;
  lastSeen?: string;
  eventKey?: string;
};

/**
 * Advance a relation's `lastSeen` only forwards.
 *
 * Several sources can feed one relation — a producer publishing on two
 * channels feeds the same `produces` edge twice — and sources are ordered by
 * name, not by time. Assigning each in turn leaves whichever sorted last, so a
 * 10:00 source could overwrite a 12:00 one and the edge would report an older
 * observation than it has.
 */
function advanceLastSeen(
  relation: { lastSeen?: string },
  lastSeen: string,
): void {
  if (!relation.lastSeen || lastSeen > relation.lastSeen) {
    relation.lastSeen = lastSeen;
  }
}

function livenessOf(relation: {
  declared: boolean;
  observed: boolean;
}): MapLiveness {
  if (relation.declared && relation.observed) return 'observed';
  return relation.declared ? 'declared-only' : 'undocumented';
}

export function buildLiveMap(
  snapshot: ArchitectureSnapshot,
  catalog: CatalogState,
): LiveMap {
  const observations = Object.values(snapshot.events);

  // Catalog ids are PascalCase, `track()` names are dotted, so both sides are
  // resolved to one node id before anything is compared.
  const catalogIdByNormalised = new Map<string, string>();
  for (const id of catalog.events.keys()) {
    catalogIdByNormalised.set(normaliseEventId(id), id);
  }
  const catalogIdFor = (name: string): string | undefined =>
    catalogIdByNormalised.get(normaliseEventId(name));
  const eventNodeIdFor = (name: string): string =>
    `event:${catalogIdFor(name) ?? name}`;

  const observedByNormalised = new Map<string, EventObservation>();
  for (const observation of observations) {
    observedByNormalised.set(normaliseEventId(observation.name), observation);
  }

  const relations = new Map<string, Relation>();
  const relation = (
    kind: MapEdgeKind,
    source: string,
    target: string,
  ): Relation => {
    const id = `${kind}:${source}->${target}`;
    let existing = relations.get(id);
    if (!existing) {
      existing = {
        id,
        kind,
        source,
        target,
        declared: false,
        observed: false,
        count: 0,
        exactCount: true,
      };
      relations.set(id, existing);
    }
    return existing;
  };

  // Nodes carry the same two-sided question as edges: is it in the catalog, and
  // did anything actually happen on it.
  type NodeState = {
    kind: MapNodeKind;
    label: string;
    declared: boolean;
    observed: boolean;
    count: number;
    lastSeen?: string;
    eventKey?: string;
  };
  const nodeStates = new Map<string, NodeState>();
  const node = (id: string, kind: MapNodeKind, label: string): NodeState => {
    let existing = nodeStates.get(id);
    if (!existing) {
      existing = { kind, label, declared: false, observed: false, count: 0 };
      nodeStates.set(id, existing);
    }
    return existing;
  };

  const witnessCount = (
    state: NodeState,
    count: number,
    lastSeen: string,
  ): void => {
    state.observed = true;
    state.count += count;
    if (!state.lastSeen || lastSeen > state.lastSeen) state.lastSeen = lastSeen;
  };

  const witness = (state: NodeState, observation: EventObservation): void =>
    witnessCount(state, observation.observedCount, observation.lastSeen);

  // ---- Declared side: what the catalog claims ---------------------------

  for (const [id, event] of catalog.events) {
    const state = node(`event:${id}`, 'event', event.name ?? id);
    state.declared = true;
  }
  for (const [id, channel] of catalog.channels) {
    node(`channel:${id}`, 'channel', channel.name ?? id).declared = true;
  }

  for (const [serviceId, service] of catalog.services) {
    node(
      `service:${serviceId}`,
      'service',
      service.name ?? serviceId,
    ).declared = true;

    for (const entry of relationships(service.sends)) {
      if (!entry.id) continue;
      const eventNodeId = eventNodeIdFor(entry.id);
      node(eventNodeId, 'event', catalogIdFor(entry.id) ?? entry.id);
      relation('produces', `service:${serviceId}`, eventNodeId).declared = true;
      for (const channelId of channelIds(entry)) {
        node(`channel:${channelId}`, 'channel', channelId);
        relation('publishes-to', eventNodeId, `channel:${channelId}`).declared =
          true;
      }
    }

    for (const entry of relationships(service.receives)) {
      if (!entry.id) continue;
      const eventNodeId = eventNodeIdFor(entry.id);
      node(eventNodeId, 'event', catalogIdFor(entry.id) ?? entry.id);
      relation('consumed-by', eventNodeId, `service:${serviceId}`).declared =
        true;
    }
  }

  // ---- Observed side: what actually ran ---------------------------------

  for (const observation of observations) {
    const catalogId = catalogIdFor(observation.name);
    const eventNodeId = eventNodeIdFor(observation.name);
    const eventState = node(
      eventNodeId,
      'event',
      catalog.events.get(catalogId ?? '')?.name ??
        catalogId ??
        observation.name,
    );
    witness(eventState, observation);
    eventState.eventKey = observation.name;

    // `observedCount` is an event-level total and the flat `producer`/`channel`
    // are first-write-wins, so attributing that total to one relationship
    // credits a second producer's traffic to the first. `sources` carries the
    // per-pair counts; the flat fields are the fallback for a snapshot written
    // before it existed, and `exactCount` records which one answered.
    const sources = observation.sources?.length
      ? observation.sources
      : [
          {
            producer: observation.producer,
            channel: observation.channel,
            count: observation.observedCount,
            lastSeen: observation.lastSeen,
          },
        ];
    const exact = Boolean(observation.sources?.length);

    for (const source of sources) {
      if (source.producer) {
        const producerNodeId = `service:${source.producer}`;
        const producerState = node(
          producerNodeId,
          'service',
          catalog.services.get(source.producer)?.name ?? source.producer,
        );
        producerState.declared ||= catalog.services.has(source.producer);
        witnessCount(producerState, source.count, source.lastSeen);

        // Corroborates only the producer that telemetry actually named. A
        // different service's declared arrow to the same event stays unproven.
        const produces = relation('produces', producerNodeId, eventNodeId);
        produces.observed = true;
        produces.count += source.count;
        produces.exactCount = exact;
        advanceLastSeen(produces, source.lastSeen);
        produces.eventKey = observation.name;
      }

      if (source.channel) {
        const channelNodeId = `channel:${source.channel}`;
        const channelState = node(
          channelNodeId,
          'channel',
          catalog.channels.get(source.channel)?.name ?? source.channel,
        );
        channelState.declared ||= catalog.channels.has(source.channel);
        witnessCount(channelState, source.count, source.lastSeen);

        const publishes = relation('publishes-to', eventNodeId, channelNodeId);
        publishes.observed = true;
        publishes.count += source.count;
        publishes.exactCount = exact;
        advanceLastSeen(publishes, source.lastSeen);
        publishes.eventKey = observation.name;
      }
    }

    // `consumers` is metadata the producer declared through `_autotel.consumers`
    // and not something the runtime watched, so it declares a relationship
    // rather than observing one. Its liveness follows the event: the event
    // really fired, and delivery to this consumer remains a claim.
    for (const consumer of observation.consumers ?? []) {
      const consumerNodeId = `service:${consumer}`;
      const consumerState = node(
        consumerNodeId,
        'service',
        catalog.services.get(consumer)?.name ?? consumer,
      );
      consumerState.declared ||= catalog.services.has(consumer);
      // The relationship is created so it is drawn, but never marked declared:
      // `_autotel.consumers` is the producer asserting who listens, which is
      // not the catalog documenting it. A consumer whose service exists but
      // whose `receives` does not name this event is an undocumented
      // relationship between two documented resources — exactly the drift
      // worth seeing. The catalog `receives` pass above is the only thing that
      // may set `declared`.
      relation('consumed-by', eventNodeId, consumerNodeId);
    }
  }

  // A consumer edge cannot be corroborated by the producer's telemetry, so it
  // takes its liveness from whether the event itself was seen. Doing this after
  // both passes means it reads the final state of the event, not a partial one.
  for (const rel of relations.values()) {
    if (rel.kind !== 'consumed-by') continue;
    const eventState = nodeStates.get(rel.source);
    if (!eventState?.observed) continue;
    rel.observed = true;
    rel.count = eventState.count;
    if (eventState.lastSeen) rel.lastSeen = eventState.lastSeen;
    rel.eventKey ??= eventState.eventKey;
  }

  const nodes: MapNode[] = [...nodeStates.entries()]
    .map(([id, state]) => ({
      id,
      kind: state.kind,
      label: state.label,
      liveness: livenessOf(state),
      count: state.count,
      ...(state.lastSeen && { lastSeen: state.lastSeen }),
      ...(state.eventKey && { eventKey: state.eventKey }),
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));

  const edges: MapEdge[] = [...relations.values()]
    .map((rel) => ({
      id: rel.id,
      source: rel.source,
      target: rel.target,
      kind: rel.kind,
      evidence:
        rel.kind === 'consumed-by'
          ? ('asserted' as const)
          : ('observed' as const),
      liveness: livenessOf(rel),
      count: rel.count,
      exactCount: rel.exactCount,
      ...(rel.lastSeen && { lastSeen: rel.lastSeen }),
      ...(rel.eventKey && { eventKey: rel.eventKey }),
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));

  const countBy = <T extends { liveness: MapLiveness }>(
    items: T[],
    liveness: MapLiveness,
  ) => items.filter((item) => item.liveness === liveness).length;

  // Ids, not display labels: an id is what someone would actually rename, and
  // "Recommendation Generated" would score differently from the
  // `RecommendationGenerated` the catalog file declares.
  const eventIdsWhere = (liveness: MapLiveness) =>
    nodes
      .filter((n) => n.kind === 'event' && n.liveness === liveness)
      .map((n) => n.id.slice('event:'.length));

  const suggestions = suggestRenamesBetween(
    eventIdsWhere('undocumented'),
    eventIdsWhere('declared-only'),
  );

  return {
    spec: LIVE_MAP_SPEC,
    generatedAt: snapshot.generatedAt,
    service: snapshot.service,
    nodes,
    edges,
    suggestions,
    summary: {
      observedEdges: countBy(edges, 'observed'),
      declaredOnlyEdges: countBy(edges, 'declared-only'),
      undocumentedEdges: countBy(edges, 'undocumented'),
      assertedEdges: edges.filter((edge) => edge.evidence === 'asserted')
        .length,
      observedNodes: countBy(nodes, 'observed'),
      declaredOnlyNodes: countBy(nodes, 'declared-only'),
      undocumentedNodes: countBy(nodes, 'undocumented'),
      totalObservations: observations.reduce(
        (sum, observation) => sum + observation.observedCount,
        0,
      ),
    },
  };
}
