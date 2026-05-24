import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from './policy';
import type { DriftReport } from './diff';
import type { DriftDelta } from './diff-vs-base';

const cleanReport: DriftReport = {
  snapshotGeneratedAt: '2026-05-21T18:04:00.000Z',
  snapshotService: 'orders',
  events: {
    observedButUndocumented: [],
    documentedButUnseen: [],
    fieldDrift: [],
    typeDrift: [],
    valueDrift: [],
  },
  services: { observedButUndocumented: [] },
  channels: { observedButUndocumented: [] },
};

function delta(hasNewDrift: boolean): DriftDelta {
  return {
    hasNewDrift,
    introduced: {
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
}

describe('evaluatePolicy', () => {
  it('fails in all mode when drift exists', () => {
    const result = evaluatePolicy({
      mode: 'all',
      report: {
        ...cleanReport,
        events: {
          ...cleanReport.events,
          observedButUndocumented: ['order.cancelled'],
        },
      },
    });
    expect(result.shouldFail).toBe(true);
    expect(result.reason).toMatch(/Drift detected/);
  });

  it('passes in all mode when drift does not exist', () => {
    const result = evaluatePolicy({ mode: 'all', report: cleanReport });
    expect(result.shouldFail).toBe(false);
    expect(result.reason).toMatch(/No drift detected/);
  });

  it('fails in new-only mode when new drift exists', () => {
    const result = evaluatePolicy({ mode: 'new-only', delta: delta(true) });
    expect(result.shouldFail).toBe(true);
    expect(result.reason).toMatch(/New drift introduced/);
  });

  it('passes in new-only mode when no new drift exists', () => {
    const result = evaluatePolicy({ mode: 'new-only', delta: delta(false) });
    expect(result.shouldFail).toBe(false);
    expect(result.reason).toMatch(/No new drift/);
  });
});
