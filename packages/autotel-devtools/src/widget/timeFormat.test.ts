/**
 * Timestamp formatting, and the zone it renders in.
 *
 * Reading telemetry from a service in another region means constantly adding
 * or subtracting hours in your head against what a colleague is quoting.
 * `Intl` already takes a zone; this is the one place that decides which.
 */

import { describe, it, expect } from 'vitest';
import { formatClock, formatStamp } from './timeFormat';

// 2026-08-25T14:30:45Z — mid-afternoon UTC, so a UTC/local mix-up is visible.
const INSTANT = Date.UTC(2026, 7, 25, 14, 30, 45);

describe('formatClock', () => {
  it('renders UTC when asked, whatever the machine is set to', () => {
    expect(formatClock(INSTANT, 'utc')).toBe('14:30:45');
  });

  it('renders a fixed zone with its own offset applied', () => {
    expect(formatClock(INSTANT, 'Asia/Tokyo')).toBe('23:30:45');
  });

  it('falls back to the local zone rather than throwing on a bad zone', () => {
    const local = formatClock(INSTANT, 'local');
    expect(formatClock(INSTANT, 'Not/AZone')).toBe(local);
  });
});

describe('formatStamp', () => {
  it('carries the date, so a window spanning midnight is readable', () => {
    expect(formatStamp(INSTANT, 'utc')).toContain('14:30:45');
    expect(formatStamp(INSTANT, 'utc')).toContain('25');
  });
});
