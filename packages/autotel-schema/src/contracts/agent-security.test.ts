import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_SECURITY_TELEMETRY_CONTRACT } from './agent-security.js';
import { contractToSnapshot, parseSnapshot, serializeSnapshot } from '../snapshot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.join(here, '../../snapshots/agent-security.snapshot.json');

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
