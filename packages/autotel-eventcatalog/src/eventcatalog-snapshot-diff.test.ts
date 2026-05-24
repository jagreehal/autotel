import { describe, expect, it } from 'vitest';
import {
  toSnapshotDiffFromDelta,
  toSnapshotDiffFromReport,
} from './eventcatalog-snapshot-diff';
import type { DriftReport } from './diff';
import type { DriftDelta } from './diff-vs-base';

const report: DriftReport = {
  snapshotGeneratedAt: '2026-05-24T00:00:00.000Z',
  snapshotService: 'orders',
  events: {
    observedButUndocumented: ['order.cancelled'],
    documentedButUnseen: ['LegacyEvent'],
    fieldDrift: [{ event: 'order.placed', extra: ['foo'], missing: ['bar'] }],
    typeDrift: [],
    valueDrift: [],
  },
  services: { observedButUndocumented: ['OrdersService'] },
  channels: { observedButUndocumented: ['orders.events'] },
};

describe('eventcatalog snapshot diff interop', () => {
  it('maps report drift to SnapshotDiff-compatible resources', () => {
    const diff = toSnapshotDiffFromReport(report);
    expect(diff.resources.some((r) => r.resourceId === 'order.cancelled')).toBe(
      true,
    );
    expect(
      diff.resources.some(
        (r) => r.resourceId === 'order.placed' && r.changeType === 'modified',
      ),
    ).toBe(true);
    expect(diff.summary.totalChanges).toBe(diff.resources.length);
  });

  it('maps introduced drift from delta in new-only mode', () => {
    const delta: DriftDelta = {
      hasNewDrift: true,
      introduced: {
        events: report.events,
        services: report.services,
        channels: report.channels,
      },
      resolved: {
        events: {
          observedButUndocumented: [],
          documentedButUnseen: [],
          fieldDrift: [],
          typeDrift: [],
          valueDrift: [],
        },
        services: { observedButUndocumented: [] },
        channels: { observedButUndocumented: [] },
      },
    };
    const diff = toSnapshotDiffFromDelta(delta);
    expect(diff.snapshotB.label).toBe('runtime:new-drift');
    expect(diff.resources.length).toBeGreaterThan(0);
  });
});
