import { describe, it, expect } from 'vitest';
import {
  compareDriftReports,
  countDriftEntries,
  countDriftDelta,
} from './diff-vs-base';
import type { DriftReport } from './diff';

function report(
  overrides: Partial<DriftReport['events']> & Partial<DriftReport> = {},
): DriftReport {
  return {
    snapshotGeneratedAt: '2026-05-22T00:00:00.000Z',
    snapshotService: 'svc',
    events: {
      observedButUndocumented: overrides.observedButUndocumented ?? [],
      documentedButUnseen: overrides.documentedButUnseen ?? [],
      fieldDrift: overrides.fieldDrift ?? [],
    },
    services: { observedButUndocumented: [] },
    channels: { observedButUndocumented: [] },
    ...overrides,
  };
}

describe('compareDriftReports', () => {
  it('reports nothing when base and head are identical', () => {
    const r = compareDriftReports(report(), report());
    expect(r.hasNewDrift).toBe(false);
    expect(r.introduced.events.observedButUndocumented).toEqual([]);
    expect(r.resolved.events.observedButUndocumented).toEqual([]);
  });

  it('reports newly observed-but-undocumented events as introduced', () => {
    const base = report({ observedButUndocumented: ['existing.event'] });
    const head = report({
      observedButUndocumented: ['existing.event', 'pr.new.event'],
    });
    const r = compareDriftReports(base, head);
    expect(r.introduced.events.observedButUndocumented).toEqual([
      'pr.new.event',
    ]);
    expect(r.hasNewDrift).toBe(true);
  });

  it('reports a drift entry that disappeared as resolved', () => {
    const base = report({
      documentedButUnseen: ['LegacyEvent', 'OtherEvent'],
    });
    const head = report({ documentedButUnseen: ['OtherEvent'] });
    const r = compareDriftReports(base, head);
    expect(r.resolved.events.documentedButUnseen).toEqual(['LegacyEvent']);
    expect(r.hasNewDrift).toBe(false);
  });

  it('reports added field paths inside an existing fieldDrift entry', () => {
    const base = report({
      fieldDrift: [
        { event: 'order.placed', extra: ['preExisting'], missing: [] },
      ],
    });
    const head = report({
      fieldDrift: [
        {
          event: 'order.placed',
          extra: ['preExisting', 'newField'],
          missing: [],
        },
      ],
    });
    const r = compareDriftReports(base, head);
    expect(r.introduced.events.fieldDrift).toEqual([
      { event: 'order.placed', extra: ['newField'], missing: [] },
    ]);
    expect(r.hasNewDrift).toBe(true);
  });

  it('treats a completely new fieldDrift event as introduced', () => {
    const base = report();
    const head = report({
      fieldDrift: [{ event: 'new.event', extra: ['field'], missing: [] }],
    });
    const r = compareDriftReports(base, head);
    expect(r.introduced.events.fieldDrift).toEqual([
      { event: 'new.event', extra: ['field'], missing: [] },
    ]);
  });

  it('treats a fieldDrift event that disappeared as resolved', () => {
    const base = report({
      fieldDrift: [{ event: 'gone', extra: ['x'], missing: ['y'] }],
    });
    const head = report();
    const r = compareDriftReports(base, head);
    expect(r.resolved.events.fieldDrift).toEqual([
      { event: 'gone', extra: ['x'], missing: ['y'] },
    ]);
  });

  it('hasNewDrift is true only when introduced has content', () => {
    const onlyResolved = compareDriftReports(
      report({ observedButUndocumented: ['fixed'] }),
      report(),
    );
    expect(onlyResolved.hasNewDrift).toBe(false);
    expect(onlyResolved.resolved.events.observedButUndocumented).toEqual([
      'fixed',
    ]);
  });
});

describe('countDriftEntries / countDriftDelta', () => {
  it('counts the introduced side of a delta', () => {
    const delta = compareDriftReports(
      report(),
      report({
        observedButUndocumented: ['order.cancelled'],
        fieldDrift: [
          {
            event: 'order.placed',
            extra: ['extra1', 'extra2'],
            missing: ['miss1'],
          },
        ],
      }),
    );
    const counts = countDriftEntries(delta.introduced);
    expect(counts.observedButUndocumentedEvents).toBe(1);
    expect(counts.fieldDriftEvents).toBe(1);
    expect(counts.fieldDriftPaths).toBe(3); // 2 extra + 1 missing
    expect(counts.total).toBe(4); // 1 observedButUndoc + 3 fieldDriftPaths
  });

  it('countDriftDelta returns both sides', () => {
    const delta = compareDriftReports(
      report({ observedButUndocumented: ['fixed.event'] }),
      report({ observedButUndocumented: ['new.event'] }),
    );
    const both = countDriftDelta(delta);
    expect(both.introduced.observedButUndocumentedEvents).toBe(1);
    expect(both.introduced.total).toBe(1);
    expect(both.resolved.observedButUndocumentedEvents).toBe(1);
    expect(both.resolved.total).toBe(1);
  });
});
