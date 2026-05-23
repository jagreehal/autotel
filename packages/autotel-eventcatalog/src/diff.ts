// Compute drift between an autotel architecture snapshot and an existing
// EventCatalog. The diff is intentionally conservative: it reports only
// existence and field-path drift. Type drift, value drift, and enum-value
// checks are deferred — they need richer signal than v0 carries.

import type { ArchitectureSnapshot } from './snapshot';
import type { CatalogState } from './catalog';

export type EventDrift = {
  /** Event names observed in the snapshot but not present in the catalog. */
  observedButUndocumented: string[];
  /** Event names declared in the catalog but never observed in the snapshot. */
  documentedButUnseen: string[];
  /** Per-event field-path mismatches. */
  fieldDrift: FieldDrift[];
};

export type FieldDrift = {
  event: string;
  /** Field paths in the observed payload but not declared in the schema. */
  extra: string[];
  /** Field paths declared in the schema but never observed in a payload. */
  missing: string[];
};

export type ServiceDrift = {
  /** Producers in the snapshot but not present in the catalog as services. */
  observedButUndocumented: string[];
};

export type ChannelDrift = {
  /** Channels in the snapshot but not present in the catalog. */
  observedButUndocumented: string[];
};

export type DriftReport = {
  snapshotGeneratedAt: string;
  snapshotService: string;
  events: EventDrift;
  services: ServiceDrift;
  channels: ChannelDrift;
};

/** True if the report contains any drift worth surfacing in a PR check. */
export function hasDrift(report: DriftReport): boolean {
  const c = countDriftReport(report);
  return c.total > 0;
}

/**
 * Per-category counts for a DriftReport. Keeps the dashboard's hero meter,
 * the CLI's summary-output, and the action's structured output all agreeing
 * on what "N findings" means.
 */
export type DriftCounts = {
  /** Total of all categories — what a dashboard "drift findings" badge shows. */
  total: number;
  observedButUndocumentedEvents: number;
  documentedButUnseenEvents: number;
  /** Number of distinct events with field-path drift entries. */
  fieldDriftEvents: number;
  /** Sum of every individual extra + missing path across all fieldDrift entries. */
  fieldDriftPaths: number;
  undocumentedServices: number;
  undocumentedChannels: number;
};

export function countDriftReport(report: DriftReport): DriftCounts {
  const fieldDriftEvents = report.events.fieldDrift.length;
  const fieldDriftPaths = report.events.fieldDrift.reduce(
    (sum, fd) => sum + fd.extra.length + fd.missing.length,
    0,
  );
  const observedButUndocumentedEvents =
    report.events.observedButUndocumented.length;
  const documentedButUnseenEvents = report.events.documentedButUnseen.length;
  const undocumentedServices = report.services.observedButUndocumented.length;
  const undocumentedChannels = report.channels.observedButUndocumented.length;

  return {
    observedButUndocumentedEvents,
    documentedButUnseenEvents,
    fieldDriftEvents,
    fieldDriftPaths,
    undocumentedServices,
    undocumentedChannels,
    total:
      observedButUndocumentedEvents +
      documentedButUnseenEvents +
      fieldDriftPaths +
      undocumentedServices +
      undocumentedChannels,
  };
}

export function diffCatalogAgainstSnapshot(
  snapshot: ArchitectureSnapshot,
  catalog: CatalogState,
): DriftReport {
  const snapshotEvents = new Set(Object.keys(snapshot.events));
  const catalogEventIds = new Set(catalog.events.keys());

  // Catalog event IDs are PascalCase ("OrderPlaced") while track() names are
  // dotted ("order.placed"). We compare on a normalised form so the same
  // event isn't reported as both missing and extra.
  const catalogEventByNormalised = new Map<string, string>();
  for (const id of catalogEventIds) {
    catalogEventByNormalised.set(normaliseEventId(id), id);
  }

  const observedButUndocumented: string[] = [];
  const matchedCatalogIds = new Set<string>();
  for (const name of snapshotEvents) {
    const matched = catalogEventByNormalised.get(normaliseEventId(name));
    if (matched) {
      matchedCatalogIds.add(matched);
    } else {
      observedButUndocumented.push(name);
    }
  }

  const documentedButUnseen: string[] = [];
  for (const id of catalogEventIds) {
    if (!matchedCatalogIds.has(id)) documentedButUnseen.push(id);
  }

  const fieldDrift: FieldDrift[] = [];
  for (const [snapName, obs] of Object.entries(snapshot.events)) {
    const catalogId = catalogEventByNormalised.get(normaliseEventId(snapName));
    if (!catalogId) continue;
    const declared = catalog.events.get(catalogId)?.declaredFieldPaths;
    if (!declared) continue;

    const declaredSet = new Set(declared);
    const observedSet = new Set(obs.fieldPaths);

    const extra = obs.fieldPaths.filter((p) => !declaredSet.has(p));
    const missing = declared.filter((p) => !observedSet.has(p));

    if (extra.length > 0 || missing.length > 0) {
      fieldDrift.push({ event: snapName, extra, missing });
    }
  }

  const snapshotServices = collectProducers(snapshot);
  const catalogServiceIds = new Set(catalog.services.keys());
  const undocumentedServices = [...snapshotServices].filter(
    (id) => !catalogServiceIds.has(id),
  );

  const snapshotChannels = collectChannels(snapshot);
  const catalogChannelIds = new Set(catalog.channels.keys());
  const undocumentedChannels = [...snapshotChannels].filter(
    (id) => !catalogChannelIds.has(id),
  );

  return {
    snapshotGeneratedAt: snapshot.generatedAt,
    snapshotService: snapshot.service,
    events: {
      observedButUndocumented: observedButUndocumented.sort(),
      documentedButUnseen: documentedButUnseen.sort(),
      fieldDrift: fieldDrift.sort((a, b) => a.event.localeCompare(b.event)),
    },
    services: { observedButUndocumented: undocumentedServices.sort() },
    channels: { observedButUndocumented: undocumentedChannels.sort() },
  };
}

function normaliseEventId(id: string): string {
  // "order.placed" -> "orderplaced", "OrderPlaced" -> "orderplaced".
  return id.toLowerCase().replace(/[._\-\s]/g, '');
}

function collectProducers(snapshot: ArchitectureSnapshot): Set<string> {
  const out = new Set<string>();
  for (const obs of Object.values(snapshot.events)) {
    if (obs.producer) out.add(obs.producer);
  }
  return out;
}

function collectChannels(snapshot: ArchitectureSnapshot): Set<string> {
  const out = new Set<string>();
  for (const obs of Object.values(snapshot.events)) {
    if (obs.channel) out.add(obs.channel);
  }
  return out;
}
