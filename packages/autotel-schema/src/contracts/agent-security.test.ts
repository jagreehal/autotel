import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_SECURITY_TELEMETRY_CONTRACT } from './agent-security.js';
import {
  contractToSnapshot,
  parseSnapshot,
  serializeSnapshot,
} from '../snapshot.js';
import { highCardinalityKeys } from '../redaction.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.join(
  here,
  '../../snapshots/agent-security.snapshot.json',
);

describe('agent-security contract snapshot', () => {
  it('matches the committed snapshot (CI gate for breaking telemetry changes)', () => {
    const current = serializeSnapshot(
      contractToSnapshot(AGENT_SECURITY_TELEMETRY_CONTRACT),
    );
    const baseline = readFileSync(snapshotPath, 'utf8');
    expect(current).toBe(baseline);
  });

  it('parses the committed snapshot', () => {
    const baseline = readFileSync(snapshotPath, 'utf8');
    expect(parseSnapshot(baseline).service).toBe('autotel-agent-security');
  });
});

describe('agent-security redaction posture', () => {
  it('protects detection ids from redaction but never the free-text note', () => {
    // `highCardinality` is a protect-list flag, not a cardinality warning: it
    // tells a redactor to leave the key alone. A correlation id has to survive
    // for a finding to be traceable; a note a human typed is the likeliest
    // place in the contract for a pasted secret and must stay redactable.
    const protectedKeys = highCardinalityKeys(
      AGENT_SECURITY_TELEMETRY_CONTRACT,
    );

    expect(protectedKeys).toContain('detection.correlation_id');
    expect(protectedKeys).not.toContain('detection.disposition.note');
  });
});
