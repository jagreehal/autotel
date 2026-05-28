import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractInteractionId,
  interactionsFromPactFile,
  listPactFiles,
  parsePactFile,
} from './pact-file.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'autotel-pact-file-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('listPactFiles', () => {
  it('returns [] for missing directory', () => {
    expect(listPactFiles(path.join(dir, 'does-not-exist'))).toEqual([]);
  });

  it('lists json files in a flat directory', () => {
    writeFileSync(path.join(dir, 'a.json'), '{}');
    writeFileSync(path.join(dir, 'b.json'), '{}');
    writeFileSync(path.join(dir, 'ignore.txt'), 'no');
    const files = listPactFiles(dir).map((f) => path.basename(f)).toSorted();
    expect(files).toEqual(['a.json', 'b.json']);
  });

  it('recurses into nested directories', () => {
    mkdirSync(path.join(dir, 'nested'));
    writeFileSync(path.join(dir, 'nested', 'c.json'), '{}');
    writeFileSync(path.join(dir, 'top.json'), '{}');
    const files = listPactFiles(dir).map((f) => path.basename(f)).toSorted();
    expect(files).toEqual(['c.json', 'top.json']);
  });
});

describe('parsePactFile', () => {
  it('returns parsed object for valid JSON', () => {
    const file = path.join(dir, 'p.json');
    writeFileSync(file, JSON.stringify({ consumer: { name: 'A' }, provider: { name: 'B' } }));
    expect(parsePactFile(file)?.consumer.name).toBe('A');
  });

  it('returns null for malformed JSON', () => {
    const file = path.join(dir, 'bad.json');
    writeFileSync(file, '{ this is not json');
    expect(parsePactFile(file)).toBeNull();
  });

  it('returns null for missing file', () => {
    expect(parsePactFile(path.join(dir, 'nope.json'))).toBeNull();
  });
});

describe('interactionsFromPactFile', () => {
  it('extracts message interactions', () => {
    const keys = interactionsFromPactFile({
      consumer: { name: 'A' },
      provider: { name: 'B' },
      messages: [
        { description: 'evt1', providerStates: [{ name: 'state' }] },
        { description: 'evt2' },
      ],
    });
    expect(keys).toEqual([
      { consumer: 'A', provider: 'B', interaction: 'evt1', kind: 'message', interactionId: undefined },
      { consumer: 'A', provider: 'B', interaction: 'evt2', kind: 'message', interactionId: undefined },
    ]);
  });

  it('extracts http interactions', () => {
    const keys = interactionsFromPactFile({
      consumer: { name: 'A' },
      provider: { name: 'B' },
      interactions: [{ description: 'GET /orders' }],
    });
    expect(keys).toEqual([
      { consumer: 'A', provider: 'B', interaction: 'GET /orders', kind: 'http', interactionId: undefined },
    ]);
  });

  it('returns [] when consumer or provider missing', () => {
    expect(
      interactionsFromPactFile({
        consumer: { name: '' },
        provider: { name: 'B' },
        messages: [{ description: 'x' }],
      }),
    ).toEqual([]);
  });

  it('picks up interactionId from metadata', () => {
    const keys = interactionsFromPactFile({
      consumer: { name: 'A' },
      provider: { name: 'B' },
      messages: [
        { description: 'evt', metadata: { interactionId: 'iid-1' } },
      ],
    });
    expect(keys[0]?.interactionId).toBe('iid-1');
  });
});

describe('extractInteractionId', () => {
  it('accepts snake_case and camelCase', () => {
    expect(extractInteractionId({ interaction_id: 'snake' })).toBe('snake');
    expect(extractInteractionId({ interactionId: 'camel' })).toBe('camel');
  });

  it('returns undefined for non-string or empty', () => {
    expect(extractInteractionId({})).toBeUndefined();
    expect(extractInteractionId({ interactionId: '' })).toBeUndefined();
    expect(extractInteractionId({ interactionId: 42 })).toBeUndefined();
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(extractInteractionId(undefined)).toBeUndefined();
  });
});
