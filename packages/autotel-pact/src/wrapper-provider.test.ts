import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLedger } from './ledger.js';
import { isInteractionLedgerEntry, isProviderVerificationRun } from './types.js';
import {
  withProviderVerification,
  type VerifierConstructor,
} from './wrapper-provider.js';

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-prov-'));
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

function mockVerifier(outcome: 'pass' | 'fail'): VerifierConstructor {
  return class {
    constructor(_opts: unknown) {}
    verifyProvider() {
      if (outcome === 'fail') return Promise.reject(new Error('verifier failed'));
      return Promise.resolve();
    }
  };
}

describe('withProviderVerification', () => {
  it('appends per-interaction rows on success only', async () => {
    const pactDir = path.join(workDir, 'pacts');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(pactDir, { recursive: true });
    writeFileSync(
      path.join(pactDir, 'A-B.json'),
      JSON.stringify({
        consumer: { name: 'A' },
        provider: { name: 'B' },
        messages: [{ description: 'evt1' }, { description: 'evt2' }],
      }),
    );

    await withProviderVerification(
      {
        provider: 'B',
        providerBaseUrl: 'http://localhost:0',
        pactUrls: [path.join(pactDir, 'A-B.json')],
      },
      { runId: 'prov-ok', Verifier: mockVerifier('pass') },
    );

    const entries = readLedger({ runId: 'prov-ok' });
    expect(entries).toHaveLength(2);
    expect(entries.every(isInteractionLedgerEntry)).toBe(true);
    expect(entries.every((e) => e.role === 'provider' && e.outcome === 'passed')).toBe(true);
  });

  it('skipVerifier emits per-interaction rows without loading or calling a Verifier', async () => {
    const pactDir = path.join(workDir, 'pacts');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(pactDir, { recursive: true });
    writeFileSync(
      path.join(pactDir, 'A-B.json'),
      JSON.stringify({
        consumer: { name: 'A' },
        provider: { name: 'B' },
        messages: [{ description: 'evt1' }, { description: 'evt2' }],
      }),
    );

    // No Verifier supplied. Without skipVerifier this would dynamically import
    // @pact-foundation/pact. With skipVerifier: true, no import happens.
    const VerifierThatWouldThrow = class {
      constructor(_opts: unknown) {
        throw new Error('Verifier should not be instantiated when skipVerifier is true');
      }
      verifyProvider() {
        throw new Error('unreachable');
      }
    };

    await withProviderVerification(
      {
        provider: 'B',
        providerBaseUrl: 'http://localhost:0',
        pactUrls: [path.join(pactDir, 'A-B.json')],
      },
      { runId: 'prov-skip', skipVerifier: true, Verifier: VerifierThatWouldThrow },
    );

    const entries = readLedger({ runId: 'prov-skip' });
    expect(entries).toHaveLength(2);
    expect(entries.every(isInteractionLedgerEntry)).toBe(true);
    expect(entries.every((e) => e.role === 'provider' && e.outcome === 'passed')).toBe(true);
  });

  it('appends run-level failure without interaction rows', async () => {
    const pactDir = path.join(workDir, 'pacts');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(pactDir, { recursive: true });
    writeFileSync(
      path.join(pactDir, 'A-B.json'),
      JSON.stringify({
        consumer: { name: 'A' },
        provider: { name: 'B' },
        messages: [{ description: 'evt' }],
      }),
    );

    await expect(
      withProviderVerification(
        {
          provider: 'B',
          providerBaseUrl: 'http://localhost:0',
          pactUrls: [path.join(pactDir, 'A-B.json')],
        },
        { runId: 'prov-fail', Verifier: mockVerifier('fail') },
      ),
    ).rejects.toThrow(/verifier failed/);

    const entries = readLedger({ runId: 'prov-fail' });
    expect(entries).toHaveLength(1);
    expect(isProviderVerificationRun(entries[0]!)).toBe(true);
  });
});
