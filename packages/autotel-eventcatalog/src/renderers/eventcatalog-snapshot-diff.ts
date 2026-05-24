import type { Renderer } from './types';
import type { DriftReport } from '../diff';
import type { DriftDelta } from '../diff-vs-base';
import {
  toSnapshotDiffFromDelta,
  toSnapshotDiffFromReport,
} from '../eventcatalog-snapshot-diff';

export const EVENTCATALOG_SNAPSHOT_DIFF_SPEC =
  'autotel-eventcatalog-snapshot-diff/v0.1.0' as const;

export type EventCatalogSnapshotDiffEnvelope = {
  spec: typeof EVENTCATALOG_SNAPSHOT_DIFF_SPEC;
  mode: 'all' | 'new-only';
  diff: ReturnType<typeof toSnapshotDiffFromReport>;
};

export function renderEventCatalogSnapshotDiffFromReport(
  report: DriftReport,
): string {
  const envelope: EventCatalogSnapshotDiffEnvelope = {
    spec: EVENTCATALOG_SNAPSHOT_DIFF_SPEC,
    mode: 'all',
    diff: toSnapshotDiffFromReport(report),
  };
  return JSON.stringify(envelope, null, 2);
}

export function renderEventCatalogSnapshotDiffFromDelta(
  delta: DriftDelta,
): string {
  const envelope: EventCatalogSnapshotDiffEnvelope = {
    spec: EVENTCATALOG_SNAPSHOT_DIFF_SPEC,
    mode: 'new-only',
    diff: toSnapshotDiffFromDelta(delta),
  };
  return JSON.stringify(envelope, null, 2);
}

export const eventcatalogSnapshotDiffRenderer: Renderer = {
  name: 'eventcatalog-snapshot-diff',
  description:
    'EventCatalog SnapshotDiff-compatible JSON for catalog-native drift views.',
  renderReport: renderEventCatalogSnapshotDiffFromReport,
  renderDelta: renderEventCatalogSnapshotDiffFromDelta,
};
