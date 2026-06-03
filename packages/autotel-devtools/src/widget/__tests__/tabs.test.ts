import { describe, it, expect } from 'vitest';
import { TAB_DEFS, TAB_ORDER } from '../tabs';
import type { TabType } from '../types';

// Forces a compile error if a TabType is added without listing it here, which
// in turn makes the runtime assertions below fail until TAB_DEFS includes it —
// so a new tab can't ship missing from the Panel / Layout tab bars.
const EVERY_TAB = {
  traces: true,
  genai: true,
  flow: true,
  resources: true,
  'service-map': true,
  metrics: true,
  logs: true,
  errors: true,
} satisfies Record<TabType, true>;

describe('shared tab definitions', () => {
  it('covers every TabType exactly once', () => {
    const expected = Object.keys(EVERY_TAB).sort();
    expect([...TAB_ORDER].sort()).toEqual(expected);
    expect(new Set(TAB_ORDER).size).toBe(TAB_ORDER.length);
  });

  it('TAB_ORDER mirrors TAB_DEFS order', () => {
    expect(TAB_ORDER).toEqual(TAB_DEFS.map((d) => d.id));
  });

  it('every tab has a non-empty label and an icon', () => {
    for (const def of TAB_DEFS) {
      expect(def.label.trim().length).toBeGreaterThan(0);
      expect(def.icon).toBeTruthy();
    }
  });
});
