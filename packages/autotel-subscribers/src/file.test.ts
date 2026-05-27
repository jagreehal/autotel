import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { FileSubscriber } from './file';

describe('FileSubscriber', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(nodePath.join(tmpdir(), 'autotel-file-sub-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends one NDJSON line per event', async () => {
    const path = nodePath.join(dir, 'events.ndjson');
    const sub = new FileSubscriber({ path });

    await sub.trackEvent('order.completed', { amount: 99 });
    await sub.trackEvent('order.refunded', { amount: 99 });
    await sub.shutdown();

    const contents = await readFile(path, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.name).toBe('order.completed');
    expect(first.type).toBe('event');
    expect(first.attributes).toEqual({ amount: 99 });

    const second = JSON.parse(lines[1]);
    expect(second.name).toBe('order.refunded');
  });

  it('creates parent directories when missing', async () => {
    const path = nodePath.join(dir, 'nested', 'deep', 'events.ndjson');
    const sub = new FileSubscriber({ path });

    await sub.trackEvent('created');
    await sub.shutdown();

    const contents = await readFile(path, 'utf8');
    expect(JSON.parse(contents.trim()).name).toBe('created');
  });

  it('supports pretty multi-line output', async () => {
    const path = nodePath.join(dir, 'pretty.json');
    const sub = new FileSubscriber({ path, pretty: true });

    await sub.trackEvent('pretty.event', { nested: { a: 1 } });
    await sub.shutdown();

    const contents = await readFile(path, 'utf8');
    expect(contents).toContain('\n  "name": "pretty.event"');
  });

  it('skips events when transform returns null', async () => {
    const path = nodePath.join(dir, 'filtered.ndjson');
    const sub = new FileSubscriber({
      path,
      transform: (p) => (p.name === 'keep' ? { kept: p.name } : null),
    });

    await sub.trackEvent('drop');
    await sub.trackEvent('keep');
    await sub.shutdown();

    const contents = await readFile(path, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ kept: 'keep' });
  });

  it('writes nothing when disabled', async () => {
    const path = nodePath.join(dir, 'disabled.ndjson');
    const sub = new FileSubscriber({ path, enabled: false });

    await sub.trackEvent('ignored');
    await sub.shutdown();

    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });
});
