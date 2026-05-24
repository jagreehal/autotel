import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  renderJson,
  renderTerminal,
  renderDeltaTerminal,
  REPORT_SPEC,
  renderEventCatalogSnapshotDiffFromReport,
  EVENTCATALOG_SNAPSHOT_DIFF_SPEC,
} from './report';
import type { DriftReport } from './diff';
import type { DriftDelta } from './diff-vs-base';

const emptyReport: DriftReport = {
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

describe('renderMarkdown', () => {
  it('renders a clean report when there is no drift', () => {
    const md = renderMarkdown(emptyReport);
    expect(md).toContain('No drift detected');
    expect(md).toContain('orders');
    expect(md).toContain('2026-05-21T18:04:00.000Z');
  });

  it('renders each drift section under a clear heading', () => {
    const md = renderMarkdown({
      ...emptyReport,
      events: {
        observedButUndocumented: ['order.cancelled'],
        documentedButUnseen: ['LegacyEvent'],
        fieldDrift: [
          {
            event: 'recommendation.generated',
            extra: ['personalization_seed'],
            missing: ['recommendations[].reason'],
          },
        ],
        typeDrift: [],
        valueDrift: [],
      },
      services: { observedButUndocumented: ['GhostService'] },
      channels: { observedButUndocumented: ['rogue.events'] },
    });

    expect(md).toContain('## Events observed but undocumented');
    expect(md).toContain('`order.cancelled`');
    expect(md).toContain('## Events documented but never observed');
    expect(md).toContain('`LegacyEvent`');
    expect(md).toContain('## Field-path drift');
    expect(md).toContain('### `recommendation.generated`');
    expect(md).toContain('`personalization_seed`');
    expect(md).toContain('`recommendations[].reason`');
    expect(md).toContain('## Services observed but undocumented');
    expect(md).toContain('`GhostService`');
    expect(md).toContain('## Channels observed but undocumented');
    expect(md).toContain('`rogue.events`');
  });
});

describe('renderJson', () => {
  it('renders a machine-readable all-mode payload', () => {
    const json = renderJson({ mode: 'all', report: emptyReport });
    const parsed = JSON.parse(json) as {
      spec: string;
      mode: string;
      report: DriftReport;
    };
    expect(parsed.spec).toBe(REPORT_SPEC);
    expect(parsed.mode).toBe('all');
    expect(parsed.report.snapshotService).toBe('orders');
  });

  it('stamps the spec marker on every envelope shape', () => {
    const allJson = JSON.parse(
      renderJson({ mode: 'all', report: emptyReport }),
    );
    const deltaJson = JSON.parse(
      renderJson({
        mode: 'new-only',
        delta: {
          hasNewDrift: false,
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
        },
      }),
    );
    expect(allJson.spec).toBe(REPORT_SPEC);
    expect(deltaJson.spec).toBe(REPORT_SPEC);
  });
});

const driftyReport: DriftReport = {
  ...emptyReport,
  events: {
    observedButUndocumented: ['order.cancelled'],
    documentedButUnseen: ['LegacyEvent'],
    fieldDrift: [
      {
        event: 'recommendation.generated',
        extra: ['personalization_seed'],
        missing: ['recommendations[].reason'],
      },
    ],
    typeDrift: [],
    valueDrift: [],
  },
};

describe('renderTerminal', () => {
  it('preserves structure but strips markdown decorations', () => {
    const text = renderTerminal(driftyReport);
    // Section heads survive, but the leading '#' marks are gone.
    expect(text).not.toMatch(/^#/m);
    expect(text).toContain('Events observed but undocumented');
    expect(text).toContain('Field-path drift');
    // No backticks around event/field names.
    expect(text).not.toContain('`order.cancelled`');
    expect(text).toContain('order.cancelled');
    expect(text).toContain('personalization_seed');
    // No ** bold marks.
    expect(text).not.toMatch(/\*\*/);
  });

  it('renders cleanly when there is no drift', () => {
    const text = renderTerminal(emptyReport);
    expect(text).toContain('No drift detected');
    expect(text).not.toContain('#');
    expect(text).not.toMatch(/\*\*/);
  });
});

describe('renderDeltaTerminal', () => {
  const noNewDrift: DriftDelta = {
    hasNewDrift: false,
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
  const newDrift: DriftDelta = {
    hasNewDrift: true,
    introduced: {
      events: {
        observedButUndocumented: ['order.cancelled'],
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

  it('strips markdown for delta-style output', () => {
    const text = renderDeltaTerminal(newDrift);
    expect(text).toContain('order.cancelled');
    expect(text).not.toMatch(/\*\*|`|^#/m);
  });

  it('renders cleanly when there is no new drift', () => {
    const text = renderDeltaTerminal(noNewDrift);
    expect(text).toContain('No new drift detected');
  });
});

describe('eventcatalog snapshot diff renderer', () => {
  it('renders a SnapshotDiff-compatible envelope', () => {
    const json = renderEventCatalogSnapshotDiffFromReport(driftyReport);
    const parsed = JSON.parse(json) as {
      spec: string;
      mode: string;
      diff: { resources: Array<{ resourceId: string; changeType: string }> };
    };
    expect(parsed.spec).toBe(EVENTCATALOG_SNAPSHOT_DIFF_SPEC);
    expect(parsed.mode).toBe('all');
    expect(
      parsed.diff.resources.some((r) => r.resourceId === 'order.cancelled'),
    ).toBe(true);
    expect(parsed.diff.resources.some((r) => r.changeType === 'modified')).toBe(
      true,
    );
  });
});
