import { describe, expect, it } from 'vitest';

import { defineContract, type TelemetryContract } from './contract.js';
import {
  diffSnapshots,
  formatDiff,
  hasBreakingChanges,
} from './diff.js';
import { highCardinalityKeys, isHighCardinalityKey } from './redaction.js';
import {
  contractToSnapshot,
  parseSnapshot,
  serializeSnapshot,
} from './snapshot.js';

const v1: TelemetryContract = defineContract({
  service: 'checkout',
  version: '1.0.0',
  commonAttributes: { 'user.id': { type: 'string', highCardinality: true } },
  spans: {
    'checkout.charge': {
      attributes: {
        'payment.provider': { type: 'string', required: true },
      },
    },
  },
});

describe('snapshot round-trip', () => {
  it('is deterministic regardless of key insertion order', () => {
    const reordered = defineContract({
      version: '1.0.0',
      service: 'checkout',
      spans: {
        'checkout.charge': {
          attributes: { 'payment.provider': { type: 'string', required: true } },
        },
      },
      commonAttributes: { 'user.id': { type: 'string', highCardinality: true } },
    });
    expect(serializeSnapshot(contractToSnapshot(v1))).toBe(
      serializeSnapshot(contractToSnapshot(reordered)),
    );
  });

  it('serializes and parses back', () => {
    const snap = contractToSnapshot(v1);
    expect(parseSnapshot(serializeSnapshot(snap))).toEqual(snap);
  });

  it('rejects an unknown snapshot spec', () => {
    expect(() => parseSnapshot('{"spec":"nope/v9","service":"x","version":"1.0.0"}')).toThrowError(
      /unexpected snapshot spec/,
    );
  });
});

describe('diffSnapshots', () => {
  it('classifies a removed span as breaking', () => {
    const v2 = defineContract({ ...v1, version: '2.0.0', spans: {} });
    const diff = diffSnapshots(contractToSnapshot(v1), contractToSnapshot(v2));
    expect(hasBreakingChanges(diff)).toBe(true);
    expect(diff.breaking.some((c) => c.type === 'span_removed')).toBe(true);
    expect(formatDiff(diff)).toMatch(/1\.0\.0 → 2\.0\.0/);
  });

  it('classifies a new span as additive, not breaking', () => {
    const v2 = defineContract({
      ...v1,
      version: '1.1.0',
      spans: {
        ...v1.spans,
        'checkout.refund': { attributes: {} },
      },
    });
    const diff = diffSnapshots(contractToSnapshot(v1), contractToSnapshot(v2));
    expect(hasBreakingChanges(diff)).toBe(false);
    expect(diff.additive.some((c) => c.type === 'span_added')).toBe(true);
  });
});

describe('redaction helpers', () => {
  it('collects high-cardinality keys across common + span attributes', () => {
    expect(highCardinalityKeys(v1)).toEqual(['user.id']);
    expect(isHighCardinalityKey(v1, 'user.id')).toBe(true);
    expect(isHighCardinalityKey(v1, 'payment.provider')).toBe(false);
  });
});
