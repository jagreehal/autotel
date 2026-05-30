import { describe, it, expect } from 'vitest';
import { formatDuration, formatDurationDetailed } from '../utils';

describe('formatDuration', () => {
  it('returns "0" for zero', () => {
    expect(formatDuration(0)).toBe('0');
  });

  it('formats nanoseconds', () => {
    expect(formatDuration(0.0005)).toBe('500ns');
  });

  it('formats microseconds', () => {
    expect(formatDuration(0.05)).toBe('50µs');
    expect(formatDuration(0.1)).toBe('100µs');
  });

  it('formats milliseconds', () => {
    expect(formatDuration(5)).toBe('5ms');
    expect(formatDuration(150)).toBe('150ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(30000)).toBe('30s');
  });

  it('formats minutes with seconds', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(120000)).toBe('2m');
  });

  it('handles negative durations with ⚠ prefix', () => {
    expect(formatDuration(-100)).toBe('⚠ 100ms');
    expect(formatDuration(-5000)).toBe('⚠ 5s');
    expect(formatDuration(0)).toBe('0');
  });

  it('trims trailing zeros from decimals', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(100)).toBe('100ms');
  });
});

describe('formatDurationDetailed', () => {
  it('returns "0" for zero', () => {
    expect(formatDurationDetailed(0)).toBe('0');
  });

  it('formats nanoseconds', () => {
    expect(formatDurationDetailed(0.0005)).toBe('500ns');
  });

  it('formats microseconds', () => {
    expect(formatDurationDetailed(0.05)).toBe('50µs');
  });

  it('formats milliseconds with one decimal', () => {
    expect(formatDurationDetailed(5)).toBe('5.0ms');
    expect(formatDurationDetailed(150.5)).toBe('150.5ms');
  });

  it('formats seconds with one decimal', () => {
    expect(formatDurationDetailed(1500)).toBe('1.5s');
    expect(formatDurationDetailed(30000)).toBe('30.0s');
  });

  it('formats minutes', () => {
    expect(formatDurationDetailed(65000)).toBe('1m');
    expect(formatDurationDetailed(120000)).toBe('2m');
  });

  it('handles negative durations', () => {
    expect(formatDurationDetailed(-100)).toBe('⚠ 100.0ms');
    expect(formatDurationDetailed(-5000)).toBe('⚠ 5.0s');
  });
});
