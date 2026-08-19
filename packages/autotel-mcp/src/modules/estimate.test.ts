import { describe, expect, it } from 'vitest';
import { EstimateInputError, estimateCost } from './estimate';

// Byte sizes are pinned here so every expected figure below is a worked
// example anyone can check with a calculator, independent of what the measured
// defaults happen to be.
const BYTES = { logLine: 250, canonicalLine: 400, span: 300 };

describe('estimateCost', () => {
  it('prices scattered lines against one canonical line per request', () => {
    // 10M requests × 4 lines × 250 B = 10 GB → $1.00 at $0.10/GB.
    // 10M requests × 1 line  × 400 B =  4 GB → $0.40.
    const result = estimateCost({
      requestsPerMonth: 10_000_000,
      logLinesPerRequest: 4,
      perGb: 0.1,
      bytes: BYTES,
    });

    expect(result.before).toEqual({ events: 40_000_000, gb: 10, cost: 1 });
    expect(result.after).toEqual({ events: 10_000_000, gb: 4, cost: 0.4 });
    expect(result.saved).toBe(0.6);
    expect(result.savedPercent).toBe(60);
  });

  it('counts spans as part of the after shape', () => {
    // after = 4 GB of canonical lines + 10M × 2 spans × 300 B = 6 GB → 10 GB,
    // which is exactly what the scattered lines cost. No saving, and the tool
    // has to be willing to say so.
    const result = estimateCost({
      requestsPerMonth: 10_000_000,
      logLinesPerRequest: 4,
      spansPerRequest: 2,
      perGb: 0.1,
      bytes: BYTES,
    });

    expect(result.after).toEqual({ events: 30_000_000, gb: 10, cost: 1 });
    expect(result.saved).toBe(0);
    expect(result.savedPercent).toBe(0);
  });

  it('applies sampling to both shapes, leaving the ratio intact', () => {
    const full = estimateCost({
      requestsPerMonth: 10_000_000,
      logLinesPerRequest: 4,
      perGb: 0.1,
      bytes: BYTES,
    });
    const halved = estimateCost({
      requestsPerMonth: 10_000_000,
      logLinesPerRequest: 4,
      keepPercent: 50,
      perGb: 0.1,
      bytes: BYTES,
    });

    expect(halved.before.cost).toBe(full.before.cost / 2);
    expect(halved.after.cost).toBe(full.after.cost / 2);
    expect(halved.savedPercent).toBe(full.savedPercent);
  });

  it('bills per indexed event on top of ingest when the rate is given', () => {
    // 40M events = 40 × $0.05 = $2.00 indexing, plus $1.00 ingest.
    const result = estimateCost({
      requestsPerMonth: 10_000_000,
      logLinesPerRequest: 4,
      perGb: 0.1,
      perMillionEvents: 0.05,
      bytes: BYTES,
    });

    expect(result.before.cost).toBe(3);
    // 10M events = $0.50 indexing, plus $0.40 ingest.
    expect(result.after.cost).toBe(0.9);
  });

  it('refuses to guess a rate', () => {
    // A cost tool that invents a price is worse than one that asks for it.
    expect(() =>
      estimateCost({ requestsPerMonth: 1000, bytes: BYTES } as never),
    ).toThrow(EstimateInputError);
  });

  it('reports the basis it used', () => {
    const result = estimateCost({
      requestsPerMonth: 10_000_000,
      logLinesPerRequest: 4,
      keepPercent: 50,
      perGb: 0.1,
      bytes: BYTES,
    });

    expect(result.basis).toMatchObject({
      logLineBytes: 250,
      canonicalLineBytes: 400,
      perGb: 0.1,
      perMillionEvents: 0,
      keepPercent: 50,
      bytesFrom: 'caller',
    });
  });

  it('measures its default byte sizes from real serialized records', () => {
    const result = estimateCost({ requestsPerMonth: 1, perGb: 0.1 });

    expect(result.basis.bytesFrom).toBe('measured');
    // The saving comes from dropping repeated envelope, not payload, so one
    // canonical line is necessarily larger than one scattered line.
    expect(result.basis.canonicalLineBytes).toBeGreaterThan(
      result.basis.logLineBytes,
    );
  });
});
