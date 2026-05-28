import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSnapshot } from './snapshot.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'autotel-ec-snapshot-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeSnapshot(name: string, body: string): string {
  const path = join(workDir, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

describe('loadSnapshot', () => {
  it('loads a valid snapshot', async () => {
    const path = writeSnapshot(
      'snap.json',
      JSON.stringify({
        spec: 'autotel-architecture/1.0',
        service: 'orders',
        generatedAt: '2026-01-01T00:00:00.000Z',
        events: {},
      }),
    );
    const snap = await loadSnapshot(path);
    expect(snap.spec).toBe('autotel-architecture/1.0');
  });

  it('throws "Snapshot not found" for a missing file', async () => {
    await expect(loadSnapshot(join(workDir, 'nope.json'))).rejects.toThrow(
      /Snapshot not found/,
    );
  });

  it('throws when path is a directory', async () => {
    const dir = join(workDir, 'dir-as-snapshot');
    mkdirSync(dir);
    await expect(loadSnapshot(dir)).rejects.toThrow(/directory, not a file/);
  });

  it('throws on an empty file', async () => {
    const path = writeSnapshot('empty.json', '');
    await expect(loadSnapshot(path)).rejects.toThrow(/Snapshot is empty/);
  });

  it('throws "not valid JSON" on malformed JSON', async () => {
    const path = writeSnapshot('bad.json', '{ not json');
    await expect(loadSnapshot(path)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the top level is not an object', async () => {
    const path = writeSnapshot('arr.json', '[1,2,3]');
    await expect(loadSnapshot(path)).rejects.toThrow(/must be a JSON object/);
  });

  it('throws and quotes the spec value when the spec marker is wrong', async () => {
    const path = writeSnapshot(
      'wrong-spec.json',
      JSON.stringify({ spec: 'other-thing/1.0', events: {} }),
    );
    await expect(loadSnapshot(path)).rejects.toThrow(/spec="other-thing\/1.0"/);
  });

  it('throws when the spec field is missing', async () => {
    const path = writeSnapshot('no-spec.json', JSON.stringify({ events: {} }));
    await expect(loadSnapshot(path)).rejects.toThrow(/no `spec` field/);
  });

  it('throws when the events map is missing', async () => {
    const path = writeSnapshot(
      'no-events.json',
      JSON.stringify({ spec: 'autotel-architecture/1.0' }),
    );
    await expect(loadSnapshot(path)).rejects.toThrow(
      /missing required `events` map/,
    );
  });

  it('throws when generatedAt is missing', async () => {
    const path = writeSnapshot(
      'no-generated.json',
      JSON.stringify({
        spec: 'autotel-architecture/1.0',
        service: 'orders',
        events: {},
      }),
    );
    await expect(loadSnapshot(path)).rejects.toThrow(
      /missing required `generatedAt`/,
    );
  });

  it('throws when service is missing or empty', async () => {
    const path = writeSnapshot(
      'no-service.json',
      JSON.stringify({
        spec: 'autotel-architecture/1.0',
        events: {},
      }),
    );
    await expect(loadSnapshot(path)).rejects.toThrow(
      /missing required `service` name/,
    );
  });

  it('throws when an event observation is missing observedCount', async () => {
    const path = writeSnapshot(
      'bad-event.json',
      JSON.stringify({
        spec: 'autotel-architecture/1.0',
        service: 'orders',
        generatedAt: '2026-01-01T00:00:00.000Z',
        events: {
          OrderPlaced: { firstSeen: 'now' },
        },
      }),
    );
    await expect(loadSnapshot(path)).rejects.toThrow(
      /missing required `observedCount`/,
    );
  });
});
