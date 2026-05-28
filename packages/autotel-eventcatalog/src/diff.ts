// Compute drift between an autotel architecture snapshot and an existing
// EventCatalog. The diff covers five drift classes:
//   - event existence (observedButUndocumented, documentedButUnseen)
//   - field-path drift (extras and missing per event)
//   - type drift (declared primitive type vs observed runtime types)
//   - value drift (declared enum vs observed sample values)
//   - service and channel existence drift

import type { ArchitectureSnapshot } from './snapshot';
import type { CatalogState } from './catalog';

export type EventDrift = {
  /** Event names observed in the snapshot but not present in the catalog. */
  observedButUndocumented: string[];
  /** Event names declared in the catalog but never observed in the snapshot. */
  documentedButUnseen: string[];
  /** Per-event field-path mismatches. */
  fieldDrift: FieldDrift[];
  /** Per-event field type mismatches against declared schema types. */
  typeDrift: TypeDrift[];
  /** Per-event enum/value mismatches against declared schema enums. */
  valueDrift: ValueDrift[];
};

export type FieldDrift = {
  event: string;
  /** Field paths in the observed payload but not declared in the schema. */
  extra: string[];
  /** Field paths declared in the schema but never observed in a payload. */
  missing: string[];
};

export type TypeDrift = {
  event: string;
  path: string;
  declared: string[];
  observed: string[];
};

export type ValueDrift = {
  event: string;
  path: string;
  declared: unknown[];
  observed: unknown[];
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
  /** Total of all categories; what a dashboard "drift findings" badge shows. */
  total: number;
  observedButUndocumentedEvents: number;
  documentedButUnseenEvents: number;
  /** Number of distinct events with field-path drift entries. */
  fieldDriftEvents: number;
  /** Sum of every individual extra + missing path across all fieldDrift entries. */
  fieldDriftPaths: number;
  typeDriftPaths: number;
  valueDriftPaths: number;
  undocumentedServices: number;
  undocumentedChannels: number;
};

export function countDriftReport(report: DriftReport): DriftCounts {
  const typeDrift = report.events.typeDrift ?? [];
  const valueDrift = report.events.valueDrift ?? [];
  const fieldDriftEvents = report.events.fieldDrift.length;
  const fieldDriftPaths = report.events.fieldDrift.reduce(
    (sum, fd) => sum + fd.extra.length + fd.missing.length,
    0,
  );
  const typeDriftPaths = typeDrift.length;
  const valueDriftPaths = valueDrift.length;
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
    typeDriftPaths,
    valueDriftPaths,
    undocumentedServices,
    undocumentedChannels,
    total:
      observedButUndocumentedEvents +
      documentedButUnseenEvents +
      fieldDriftPaths +
      typeDriftPaths +
      valueDriftPaths +
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
  const typeDrift: TypeDrift[] = [];
  const valueDrift: ValueDrift[] = [];
  for (const [snapName, obs] of Object.entries(snapshot.events)) {
    const catalogId = catalogEventByNormalised.get(normaliseEventId(snapName));
    if (!catalogId) continue;
    const eventDecl = catalog.events.get(catalogId);
    const declared = eventDecl?.declaredFieldPaths;
    if (!declared) continue;

    const declaredSet = new Set(declared);
    const observedSet = new Set(obs.fieldPaths);

    const extra = obs.fieldPaths.filter((p) => !declaredSet.has(p));
    const missing = declared.filter((p) => !observedSet.has(p));

    if (extra.length > 0 || missing.length > 0) {
      fieldDrift.push({ event: snapName, extra, missing });
    }

    const constraints = eventDecl?.declaredSchemaConstraints ?? {};
    const stats = obs.fieldStats ?? {};
    for (const [path, declaredConstraint] of Object.entries(constraints)) {
      const observed = stats[path];
      if (!observed) continue;
      if (declaredConstraint.types && declaredConstraint.types.length > 0) {
        // JSON Schema has `integer`; JavaScript has only `number`. Treat the
        // two as compatible at the runtime-type level, then use sample values
        // to flag the real signal (a non-integer value seen against an
        // integer-only declaration).
        const accepts = expandDeclaredTypes(declaredConstraint.types);
        const badTypes = observed.types.filter((t: string) => !accepts.has(t));
        const integerDeclared =
          declaredConstraint.types.includes('integer') &&
          !declaredConstraint.types.includes('number');
        const nonIntegerSamples = integerDeclared
          ? observed.sampleValues.filter(
              (v: unknown) => typeof v === 'number' && !Number.isInteger(v),
            )
          : [];
        if (badTypes.length > 0 || nonIntegerSamples.length > 0) {
          typeDrift.push({
            event: snapName,
            path,
            declared: declaredConstraint.types,
            observed: [...new Set(observed.types)].toSorted(),
          });
        }
      }
      if (
        declaredConstraint.enumValues &&
        declaredConstraint.enumValues.length > 0 &&
        observed.sampleValues.length > 0
      ) {
        const observedOutsideEnum = observed.sampleValues.filter(
          (v: unknown) =>
            !declaredConstraint.enumValues?.some((d) => Object.is(d, v)),
        );
        if (observedOutsideEnum.length > 0) {
          valueDrift.push({
            event: snapName,
            path,
            declared: declaredConstraint.enumValues,
            observed: [...new Set(observedOutsideEnum)] as unknown[],
          });
        }
      }
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
      typeDrift: typeDrift.sort((a, b) =>
        `${a.event}.${a.path}`.localeCompare(`${b.event}.${b.path}`),
      ),
      valueDrift: valueDrift.sort((a, b) =>
        `${a.event}.${a.path}`.localeCompare(`${b.event}.${b.path}`),
      ),
    },
    services: { observedButUndocumented: undocumentedServices.sort() },
    channels: { observedButUndocumented: undocumentedChannels.sort() },
  };
}

/**
 * Map declared JSON Schema types to the set of runtime types we accept at
 * `typeof` level. JSON Schema's `integer` is a refinement of `number` (JS
 * does not have a separate integer type), so we accept observed `number` for
 * either declaration. The integer-vs-fractional distinction is then enforced
 * separately against sample values.
 */
function expandDeclaredTypes(declared: string[]): Set<string> {
  const accepts = new Set<string>(declared);
  if (declared.includes('integer')) accepts.add('number');
  return accepts;
}

function normaliseEventId(id: string): string {
  // "order.placed" -> "orderplaced", "OrderPlaced" -> "orderplaced".
  return id.toLowerCase().replaceAll(/[._\-\s]/g, '');
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
