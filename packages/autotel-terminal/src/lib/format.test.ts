import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDurationMs,
  formatRelative,
  truncate,
  buildWaterfallBar,
  buildTimeRuler,
  computeMarkerPositions,
  buildWaterfallBarWithMarkers,
  adjustPanelSplit,
} from './format';

describe('formatDurationMs', () => {
  it('formats ms when under 1000', () => {
    expect(formatDurationMs(0)).toBe('0ms');
    expect(formatDurationMs(500)).toBe('500ms');
  });

  it('formats seconds when 1000+', () => {
    expect(formatDurationMs(1000)).toBe('1.00s');
    expect(formatDurationMs(1500)).toBe('1.50s');
  });
});

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for recent or future', () => {
    vi.setSystemTime(1000);
    expect(formatRelative(999)).toBe('just now');
    expect(formatRelative(500)).toBe('just now');
  });

  it('returns "Ns ago" for seconds', () => {
    vi.setSystemTime(10_000);
    expect(formatRelative(5000)).toBe('5s ago');
    expect(formatRelative(0)).toBe('10s ago');
  });

  it('returns "Nm ago" for minutes', () => {
    vi.setSystemTime(120_000); // 2 min
    expect(formatRelative(60_000)).toBe('1m ago');
  });

  it('returns "Nh ago" for hours', () => {
    vi.setSystemTime(7_200_000);
    expect(formatRelative(0)).toBe('2h ago');
  });
});

describe('truncate', () => {
  it('returns as-is when within width', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis when over width', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
    expect(truncate('hello world', 6)).toBe('hello…');
  });
});

describe('buildWaterfallBar', () => {
  it('full-width bar for root span', () => {
    const result = buildWaterfallBar(0, 100, 0, 100, 20);
    expect(result.length).toBe(20);
    expect(result.trim().length).toBeGreaterThan(0);
    expect(result).not.toMatch(/^ +$/);
  });

  it('half-width bar offset to middle', () => {
    const result = buildWaterfallBar(50, 50, 0, 100, 20);
    expect(result.length).toBe(20);
    expect(result.slice(0, 10)).toMatch(/^ +$/);
    expect(result.slice(10).trim().length).toBeGreaterThan(0);
  });

  it('minimum 1-char bar for tiny spans', () => {
    const result = buildWaterfallBar(0, 1, 0, 10_000, 20);
    expect(result.length).toBe(20);
    expect(result.replaceAll(' ', '').length).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty string for non-positive widths', () => {
    expect(buildWaterfallBar(0, 100, 0, 100, 0)).toBe('');
    expect(buildWaterfallBar(0, 100, 0, 100, -1)).toBe('');
  });

  it('clamps spans that start before the trace window', () => {
    expect(() => buildWaterfallBar(90, 20, 100, 100, 20)).not.toThrow();
    expect(buildWaterfallBar(90, 20, 100, 100, 20)).toHaveLength(20);
  });
});

describe('buildTimeRuler', () => {
  it('creates a ruler with 0ms and total at edges', () => {
    const ruler = buildTimeRuler(1000, 40);
    expect(ruler).toContain('0ms');
    expect(ruler).toContain('1.00s');
    expect(ruler.length).toBe(40);
  });

  it('uses seconds for large durations', () => {
    const ruler = buildTimeRuler(2500, 40);
    expect(ruler).toContain('2.50s');
  });

  it('returns spaces for tiny width', () => {
    const ruler = buildTimeRuler(100, 5);
    expect(ruler).toBe('     ');
  });

  it('returns an empty string for non-positive widths', () => {
    expect(buildTimeRuler(100, 0)).toBe('');
    expect(buildTimeRuler(100, -1)).toBe('');
  });
});

describe('computeMarkerPositions', () => {
  it('maps event times to bar column offsets', () => {
    const positions = computeMarkerPositions([150], 100, 200, 0, 1000, 10);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toBe(1);
  });

  it('handles multiple markers', () => {
    const positions = computeMarkerPositions(
      [50, 100, 150],
      0,
      200,
      0,
      200,
      20,
    );
    expect(positions).toHaveLength(3);
    expect(positions[0]).toBe(5);
    expect(positions[1]).toBe(10);
    expect(positions[2]).toBe(15);
  });

  it('clamps markers to bar width', () => {
    const positions = computeMarkerPositions([-100, 5000], 0, 100, 0, 100, 10);
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBe(9);
  });

  it('returns empty for no markers', () => {
    expect(computeMarkerPositions([], 0, 100, 0, 100, 10)).toEqual([]);
  });
});

describe('buildWaterfallBarWithMarkers', () => {
  it('overlays event markers on the bar', () => {
    const result = buildWaterfallBarWithMarkers([50], 0, 100, 0, 100, 10);
    expect(result).toHaveLength(10);
    expect(result).toContain('◆');
  });

  it('preserves bar when no markers', () => {
    const plainBar = buildWaterfallBar(0, 100, 0, 100, 10);
    const withMarkers = buildWaterfallBarWithMarkers([], 0, 100, 0, 100, 10);
    expect(withMarkers).toBe(plainBar);
  });
});

describe('adjustPanelSplit', () => {
  it('adjusts by delta', () => {
    expect(adjustPanelSplit(50, 5)).toBe(55);
    expect(adjustPanelSplit(50, -5)).toBe(45);
  });

  it('clamps to min', () => {
    expect(adjustPanelSplit(25, -10)).toBe(20);
  });

  it('clamps to max', () => {
    expect(adjustPanelSplit(75, 10)).toBe(80);
  });

  it('respects custom bounds', () => {
    expect(adjustPanelSplit(50, -40, 30, 70)).toBe(30);
    expect(adjustPanelSplit(50, 40, 30, 70)).toBe(70);
  });
});
