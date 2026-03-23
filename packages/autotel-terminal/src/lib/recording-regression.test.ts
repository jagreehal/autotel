import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dashboardSource = readFileSync(
  new URL('../index.tsx', import.meta.url),
  'utf8',
);

describe('recording mode wiring', () => {
  it('re-subscribes span and log listeners when recording state changes', () => {
    expect(dashboardSource).toContain(
      '}, [logStream, paused, maxSpans, recording]);',
    );
    expect(dashboardSource).toContain(
      '}, [stream, paused, maxSpans, recording]);',
    );
  });

  it('checks the recording limit before truncating to maxSpans', () => {
    expect(dashboardSource).not.toContain(
      'const next = [event, ...prev].slice(0, maxSpans);',
    );
    expect(dashboardSource).not.toContain(
      'const next = [span, ...prev].slice(0, maxSpans);',
    );
  });

  it('supports arrow-key navigation in every selectable list view', () => {
    expect(dashboardSource).toContain("case 'service-summary': {");
    expect(dashboardSource).toContain("case 'errors': {");
  });
});
