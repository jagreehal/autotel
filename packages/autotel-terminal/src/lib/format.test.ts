import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatDurationMs, formatRelative, truncate } from './format';

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
