import { describe, expect, it } from 'vitest';
import { AGENT_SECURITY_TELEMETRY_CONTRACT } from 'autotel-schema';
import {
  DETECTION_ATTR,
  DETECTION_DISPOSITION_ATTR,
  DETECTION_EVENT,
} from './index.js';

describe('detection telemetry is covered by the published contract', () => {
  // Attributes outside the contract are outside the diff gate: renaming or
  // dropping one passes CI, and whatever an auditor built on it breaks
  // silently. Comparing the emitted keys to the contract — code against code —
  // is the only version of this check that cannot drift.
  const declared = new Set(
    Object.keys(AGENT_SECURITY_TELEMETRY_CONTRACT.commonAttributes ?? {}),
  );

  it('declares every key a detection record carries', () => {
    for (const key of Object.values(DETECTION_ATTR)) {
      expect(declared).toContain(key);
    }
  });

  it('declares every key a disposition record carries', () => {
    for (const key of Object.values(DETECTION_DISPOSITION_ATTR)) {
      expect(declared).toContain(key);
    }
  });
});

describe('detection record names are part of the public API', () => {
  it('exports the canonical field names consumers query on', () => {
    // A consumer writing a dashboard needs the same constants the emitter uses;
    // without them they retype the strings and drift from the contract.
    expect(DETECTION_EVENT).toBe('agent.sequence.detected');
    expect(DETECTION_ATTR.ruleId).toBe('detection.rule_id');
  });
});
