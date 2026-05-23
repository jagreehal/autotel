// Tests for the renderer registry (the adapter shape). Per-renderer
// behavioural tests live in ../report.test.ts.

import { describe, it, expect } from 'vitest';
import { RENDERERS, RENDERER_NAMES, getRenderer } from './index';
import type { DriftReport } from '../diff';
import type { DriftDelta } from '../diff-vs-base';

const emptyReport: DriftReport = {
  snapshotGeneratedAt: '2026-05-22T00:00:00.000Z',
  snapshotService: 'fixture',
  events: {
    observedButUndocumented: [],
    documentedButUnseen: [],
    fieldDrift: [],
  },
  services: { observedButUndocumented: [] },
  channels: { observedButUndocumented: [] },
};

const cleanDelta: DriftDelta = {
  hasNewDrift: false,
  introduced: emptyReport.events && {
    events: {
      observedButUndocumented: [],
      documentedButUnseen: [],
      fieldDrift: [],
    },
    services: { observedButUndocumented: [] },
    channels: { observedButUndocumented: [] },
  },
  resolved: {
    events: {
      observedButUndocumented: [],
      documentedButUnseen: [],
      fieldDrift: [],
    },
    services: { observedButUndocumented: [] },
    channels: { observedButUndocumented: [] },
  },
};

describe('renderer registry', () => {
  it('ships at least the three built-in renderers', () => {
    expect(RENDERER_NAMES).toEqual(
      expect.arrayContaining(['markdown', 'terminal', 'json']),
    );
  });

  it('every renderer has a name, description, and both render functions', () => {
    for (const r of RENDERERS) {
      expect(typeof r.name).toBe('string');
      expect(r.name.length).toBeGreaterThan(0);
      expect(typeof r.description).toBe('string');
      expect(typeof r.renderReport).toBe('function');
      expect(typeof r.renderDelta).toBe('function');
    }
  });

  it('every renderer produces a non-empty string for both shapes', () => {
    for (const r of RENDERERS) {
      const reportOutput = r.renderReport(emptyReport);
      const deltaOutput = r.renderDelta(cleanDelta);
      expect(reportOutput.length).toBeGreaterThan(0);
      expect(deltaOutput.length).toBeGreaterThan(0);
    }
  });

  it('getRenderer looks up by name', () => {
    expect(getRenderer('markdown')?.name).toBe('markdown');
    expect(getRenderer('json')?.name).toBe('json');
    expect(getRenderer('terminal')?.name).toBe('terminal');
  });

  it('getRenderer returns undefined for unknown names', () => {
    expect(getRenderer('sarif')).toBeUndefined();
    expect(getRenderer('')).toBeUndefined();
  });
});
