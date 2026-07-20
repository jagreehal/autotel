import type { DriftReport } from './diff';
import type { DriftDelta, DriftEntries } from './diff-vs-base';

export type SnapshotResourceType =
  'event' | 'command' | 'query' | 'service' | 'domain' | 'channel';

export type ResourceChangeType = 'added' | 'removed' | 'modified' | 'versioned';

export type ResourceChange = {
  resourceId: string;
  version: string;
  type: SnapshotResourceType;
  changeType: ResourceChangeType;
  changedFields?: string[];
  previousVersion?: string;
  newVersion?: string;
};

export type RelationshipChange = {
  serviceId: string;
  serviceVersion: string;
  resourceId: string;
  resourceVersion?: string;
  direction: 'sends' | 'receives';
  changeType: 'added' | 'removed';
};

export type EventCatalogSnapshotDiff = {
  snapshotA: { label: string; createdAt: string };
  snapshotB: { label: string; createdAt: string };
  summary: {
    totalChanges: number;
    resourcesAdded: number;
    resourcesRemoved: number;
    resourcesModified: number;
    resourcesVersioned: number;
    relationshipsAdded: number;
    relationshipsRemoved: number;
  };
  resources: ResourceChange[];
  relationships: RelationshipChange[];
};

export function toSnapshotDiffFromReport(
  report: DriftReport,
): EventCatalogSnapshotDiff {
  const entries: DriftEntries = {
    events: report.events,
    services: report.services,
    channels: report.channels,
  };
  return snapshotDiffForEntries(entries, report.snapshotGeneratedAt, 'runtime');
}

export function toSnapshotDiffFromDelta(
  delta: DriftDelta,
): EventCatalogSnapshotDiff {
  return snapshotDiffForEntries(
    delta.introduced,
    new Date(0).toISOString(),
    'runtime:new-drift',
  );
}

function snapshotDiffForEntries(
  entries: DriftEntries,
  createdAt: string,
  label: string,
): EventCatalogSnapshotDiff {
  const resources: ResourceChange[] = [];
  const relationships: RelationshipChange[] = [];

  for (const eventName of entries.events.observedButUndocumented) {
    resources.push({
      resourceId: eventName,
      version: 'runtime',
      type: 'event',
      changeType: 'added',
    });
  }

  for (const eventName of entries.events.documentedButUnseen) {
    resources.push({
      resourceId: eventName,
      version: 'runtime',
      type: 'event',
      changeType: 'removed',
    });
  }

  for (const drift of entries.events.fieldDrift) {
    resources.push({
      resourceId: drift.event,
      version: 'runtime',
      type: 'event',
      changeType: 'modified',
      changedFields: [
        ...drift.extra.map((p) => `extra:${p}`),
        ...drift.missing.map((p) => `missing:${p}`),
      ],
    });
  }

  for (const drift of entries.events.typeDrift ?? []) {
    resources.push({
      resourceId: drift.event,
      version: 'runtime',
      type: 'event',
      changeType: 'modified',
      changedFields: [`type:${drift.path}`],
    });
  }

  for (const drift of entries.events.valueDrift ?? []) {
    resources.push({
      resourceId: drift.event,
      version: 'runtime',
      type: 'event',
      changeType: 'modified',
      changedFields: [`enum:${drift.path}`],
    });
  }

  for (const serviceId of entries.services.observedButUndocumented) {
    resources.push({
      resourceId: serviceId,
      version: 'runtime',
      type: 'service',
      changeType: 'added',
    });
  }

  for (const channelId of entries.channels.observedButUndocumented) {
    resources.push({
      resourceId: channelId,
      version: 'runtime',
      type: 'channel',
      changeType: 'added',
    });
  }

  const summary = {
    totalChanges: resources.length + relationships.length,
    resourcesAdded: resources.filter((r) => r.changeType === 'added').length,
    resourcesRemoved: resources.filter((r) => r.changeType === 'removed')
      .length,
    resourcesModified: resources.filter((r) => r.changeType === 'modified')
      .length,
    resourcesVersioned: resources.filter((r) => r.changeType === 'versioned')
      .length,
    relationshipsAdded: relationships.filter((r) => r.changeType === 'added')
      .length,
    relationshipsRemoved: relationships.filter(
      (r) => r.changeType === 'removed',
    ).length,
  };

  return {
    snapshotA: { label: 'catalog', createdAt: new Date(0).toISOString() },
    snapshotB: { label, createdAt },
    summary,
    resources,
    relationships,
  };
}
