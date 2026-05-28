// Compare two drift reports (base branch vs PR head) and produce a "what
// this PR introduces" view. Without this, a PR check fails forever on
// pre-existing drift; with it, the check only fails on drift the PR is
// responsible for.

import type {
  DriftReport,
  FieldDrift,
  DriftCounts,
  TypeDrift,
  ValueDrift,
} from './diff';

export type DriftDelta = {
  /** Drift entries present in head but not in base. */
  introduced: DriftEntries;
  /** Drift entries present in base but not in head; the PR fixed these. */
  resolved: DriftEntries;
  /** True if `introduced` has any non-empty section. */
  hasNewDrift: boolean;
};

export type DriftEntries = {
  events: {
    observedButUndocumented: string[];
    documentedButUnseen: string[];
    fieldDrift: FieldDrift[];
    typeDrift: TypeDrift[];
    valueDrift: ValueDrift[];
  };
  services: { observedButUndocumented: string[] };
  channels: { observedButUndocumented: string[] };
};

export function compareDriftReports(
  base: DriftReport,
  head: DriftReport,
): DriftDelta {
  const introducedEvents = diffStringList(
    base.events.observedButUndocumented,
    head.events.observedButUndocumented,
  );
  const introducedMissing = diffStringList(
    base.events.documentedButUnseen,
    head.events.documentedButUnseen,
  );
  const introducedFieldDrift = diffFieldDrift(
    base.events.fieldDrift,
    head.events.fieldDrift,
  );
  const introducedServices = diffStringList(
    base.services.observedButUndocumented,
    head.services.observedButUndocumented,
  );
  const introducedChannels = diffStringList(
    base.channels.observedButUndocumented,
    head.channels.observedButUndocumented,
  );

  const introduced: DriftEntries = {
    events: {
      observedButUndocumented: introducedEvents.added,
      documentedButUnseen: introducedMissing.added,
      fieldDrift: introducedFieldDrift.added,
      typeDrift: diffTypeDrift(
        base.events.typeDrift ?? [],
        head.events.typeDrift ?? [],
      ).added,
      valueDrift: diffValueDrift(
        base.events.valueDrift ?? [],
        head.events.valueDrift ?? [],
      ).added,
    },
    services: { observedButUndocumented: introducedServices.added },
    channels: { observedButUndocumented: introducedChannels.added },
  };

  const resolved: DriftEntries = {
    events: {
      observedButUndocumented: introducedEvents.removed,
      documentedButUnseen: introducedMissing.removed,
      fieldDrift: introducedFieldDrift.removed,
      typeDrift: diffTypeDrift(
        base.events.typeDrift ?? [],
        head.events.typeDrift ?? [],
      ).removed,
      valueDrift: diffValueDrift(
        base.events.valueDrift ?? [],
        head.events.valueDrift ?? [],
      ).removed,
    },
    services: { observedButUndocumented: introducedServices.removed },
    channels: { observedButUndocumented: introducedChannels.removed },
  };

  const hasNewDrift =
    introduced.events.observedButUndocumented.length > 0 ||
    introduced.events.documentedButUnseen.length > 0 ||
    introduced.events.fieldDrift.length > 0 ||
    introduced.events.typeDrift.length > 0 ||
    introduced.events.valueDrift.length > 0 ||
    introduced.services.observedButUndocumented.length > 0 ||
    introduced.channels.observedButUndocumented.length > 0;

  return { introduced, resolved, hasNewDrift };
}

/**
 * Per-category counts for one side of a DriftDelta (introduced or resolved).
 * Same shape as DriftCounts so dashboards and CI can render the
 * introduced/resolved sections with identical accounting.
 */
export function countDriftEntries(entries: DriftEntries): DriftCounts {
  const fieldDriftEvents = entries.events.fieldDrift.length;
  const fieldDriftPaths = entries.events.fieldDrift.reduce(
    (sum, fd) => sum + fd.extra.length + fd.missing.length,
    0,
  );
  const observedButUndocumentedEvents =
    entries.events.observedButUndocumented.length;
  const documentedButUnseenEvents = entries.events.documentedButUnseen.length;
  const undocumentedServices = entries.services.observedButUndocumented.length;
  const undocumentedChannels = entries.channels.observedButUndocumented.length;
  const typeDriftPaths = (entries.events.typeDrift ?? []).length;
  const valueDriftPaths = (entries.events.valueDrift ?? []).length;

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

export function countDriftDelta(delta: DriftDelta): {
  introduced: DriftCounts;
  resolved: DriftCounts;
} {
  return {
    introduced: countDriftEntries(delta.introduced),
    resolved: countDriftEntries(delta.resolved),
  };
}

function diffStringList(
  base: string[],
  head: string[],
): { added: string[]; removed: string[] } {
  const baseSet = new Set(base);
  const headSet = new Set(head);
  return {
    added: head.filter((s) => !baseSet.has(s)).sort(),
    removed: base.filter((s) => !headSet.has(s)).sort(),
  };
}

function diffFieldDrift(
  base: FieldDrift[],
  head: FieldDrift[],
): { added: FieldDrift[]; removed: FieldDrift[] } {
  const baseByEvent = new Map(base.map((d) => [d.event, d]));
  const headByEvent = new Map(head.map((d) => [d.event, d]));

  const added: FieldDrift[] = [];
  const removed: FieldDrift[] = [];

  for (const [event, h] of headByEvent) {
    const b = baseByEvent.get(event);
    if (!b) {
      // Entire event's field drift is new to head.
      added.push(h);
      continue;
    }
    const addedExtra = h.extra.filter((p) => !b.extra.includes(p));
    const addedMissing = h.missing.filter((p) => !b.missing.includes(p));
    if (addedExtra.length > 0 || addedMissing.length > 0) {
      added.push({ event, extra: addedExtra, missing: addedMissing });
    }
  }

  for (const [event, b] of baseByEvent) {
    const h = headByEvent.get(event);
    if (!h) {
      removed.push(b);
      continue;
    }
    const removedExtra = b.extra.filter((p) => !h.extra.includes(p));
    const removedMissing = b.missing.filter((p) => !h.missing.includes(p));
    if (removedExtra.length > 0 || removedMissing.length > 0) {
      removed.push({ event, extra: removedExtra, missing: removedMissing });
    }
  }

  return { added, removed };
}

function diffTypeDrift(
  base: TypeDrift[],
  head: TypeDrift[],
): { added: TypeDrift[]; removed: TypeDrift[] } {
  return diffStructuredByKey(base, head, (x) => `${x.event}::${x.path}`);
}

function diffValueDrift(
  base: ValueDrift[],
  head: ValueDrift[],
): { added: ValueDrift[]; removed: ValueDrift[] } {
  return diffStructuredByKey(base, head, (x) => `${x.event}::${x.path}`);
}

function diffStructuredByKey<T>(
  base: T[],
  head: T[],
  keyOf: (v: T) => string,
): { added: T[]; removed: T[] } {
  const baseMap = new Map(base.map((v) => [keyOf(v), v]));
  const headMap = new Map(head.map((v) => [keyOf(v), v]));
  const added: T[] = [];
  const removed: T[] = [];

  for (const [k, hv] of headMap) {
    const bv = baseMap.get(k);
    if (!bv || JSON.stringify(bv) !== JSON.stringify(hv)) added.push(hv);
  }
  for (const [k, bv] of baseMap) {
    const hv = headMap.get(k);
    if (!hv || JSON.stringify(hv) !== JSON.stringify(bv)) removed.push(bv);
  }
  return { added, removed };
}
