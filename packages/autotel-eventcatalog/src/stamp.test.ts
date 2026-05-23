import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stampCatalog,
  buildStampBlock,
  buildStampSummary,
  STAMP_START,
  STAMP_END,
  STAMP_SUMMARY_SPEC,
} from './stamp';
import type { ArchitectureSnapshot, EventObservation } from './snapshot';

function obs(overrides: Partial<EventObservation> = {}): EventObservation {
  return {
    name: 'order.placed',
    observedCount: 12,
    firstSeen: '2026-05-22T05:20:00.000Z',
    lastSeen: '2026-05-22T05:23:50.024Z',
    fieldPaths: ['orderId', 'customerId', 'items[].sku'],
    sampleTraceIds: [],
    producer: 'OrdersService',
    channel: 'orders.events',
    ...overrides,
  };
}

function snap(events: ArchitectureSnapshot['events']): ArchitectureSnapshot {
  return {
    spec: 'autotel-architecture/v0.1.0',
    generatedAt: '2026-05-22T05:24:00.000Z',
    service: 'example',
    events,
  };
}

describe('buildStampBlock', () => {
  it('includes volume, last-seen, producer, channel', () => {
    const b = buildStampBlock(obs());
    expect(b).toContain(STAMP_START);
    expect(b).toContain(STAMP_END);
    expect(b).toContain('**Volume**: 12 events');
    expect(b).toContain('**Last seen**: 2026-05-22 05:23 UTC');
    expect(b).toContain('**Producer**: OrdersService');
    expect(b).toContain('**Channel**: `orders.events`');
  });

  it('lists field paths as inline code', () => {
    const b = buildStampBlock(obs({ fieldPaths: ['a', 'b.c'] }));
    expect(b).toContain('`a`, `b.c`');
  });

  it('omits sample-traces section when none observed', () => {
    const b = buildStampBlock(obs({ sampleTraceIds: [] }));
    expect(b).not.toContain('Sample traces');
  });

  it('includes sample-traces section when present', () => {
    const b = buildStampBlock(obs({ sampleTraceIds: ['t1', 't2'] }));
    expect(b).toContain('**Sample traces**: `t1`, `t2`');
  });
});

describe('stampCatalog', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'autotel-stamp-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeEventFile(
    catalogId: string,
    body: string,
  ): Promise<string> {
    const evDir = join(
      dir,
      'domains',
      'X',
      'services',
      'S',
      'events',
      catalogId,
    );
    await mkdir(evDir, { recursive: true });
    const file = join(evDir, 'index.mdx');
    const frontmatter = `---\nid: ${catalogId}\nversion: 1.0.0\n---\n\n`;
    await writeFile(file, frontmatter + body, 'utf8');
    return file;
  }

  it('inserts a stamp block before <Footer /> on first run', async () => {
    const file = await writeEventFile(
      'OrderPlaced',
      '## Overview\n\nA description.\n\n<Footer />\n',
    );

    const result = await stampCatalog({
      snapshot: snap({ 'order.placed': obs() }),
      catalogPath: dir,
    });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      catalogId: 'OrderPlaced',
      action: 'insert',
    });

    const content = await readFile(file, 'utf8');
    expect(content).toContain(STAMP_START);
    expect(content).toContain('**Volume**: 12 events');
    // Stamp should come before <Footer />
    expect(content.indexOf(STAMP_START)).toBeLessThan(
      content.indexOf('<Footer />'),
    );
  });

  it('replaces the content between markers on subsequent runs', async () => {
    const file = await writeEventFile(
      'OrderPlaced',
      `## Overview\n\n${STAMP_START}\n\n<div>old block</div>\n\n${STAMP_END}\n\n<Footer />\n`,
    );

    const result = await stampCatalog({
      snapshot: snap({ 'order.placed': obs({ observedCount: 999 }) }),
      catalogPath: dir,
    });

    expect(result.updates[0].action).toBe('replace');
    const content = await readFile(file, 'utf8');
    expect(content).not.toContain('old block');
    expect(content).toContain('**Volume**: 999 events');
    expect(content.match(new RegExp(STAMP_START, 'g'))!).toHaveLength(1);
  });

  it('skips events that have no matching catalog entry', async () => {
    await writeEventFile('OrderPlaced', '## Overview\n\n<Footer />\n');

    const result = await stampCatalog({
      snapshot: snap({
        'order.placed': obs(),
        'mystery.event': obs({ name: 'mystery.event' }),
      }),
      catalogPath: dir,
    });

    expect(result.updates).toHaveLength(1);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0]).toMatchObject({
      snapshotName: 'mystery.event',
      reason: 'no-catalog-match',
    });
  });

  it('appends at file end when no <Footer /> is present', async () => {
    const file = await writeEventFile(
      'OrderPlaced',
      '## Overview\n\nJust prose, no footer.\n',
    );

    await stampCatalog({
      snapshot: snap({ 'order.placed': obs() }),
      catalogPath: dir,
    });

    const content = await readFile(file, 'utf8');
    expect(content).toContain(STAMP_START);
    expect(content).toContain('Just prose, no footer.');
    expect(content.indexOf('Just prose, no footer.')).toBeLessThan(
      content.indexOf(STAMP_START),
    );
  });

  it('matches dotted snapshot names to PascalCase catalog ids', async () => {
    await writeEventFile('OrderPlaced', '## o\n');
    const result = await stampCatalog({
      snapshot: snap({ 'order.placed': obs() }),
      catalogPath: dir,
    });
    expect(result.updates[0]?.catalogId).toBe('OrderPlaced');
  });

  it('dryRun returns the plan without writing files', async () => {
    const file = await writeEventFile('OrderPlaced', '## o\n');
    const before = await readFile(file, 'utf8');

    await stampCatalog({
      snapshot: snap({ 'order.placed': obs() }),
      catalogPath: dir,
      dryRun: true,
    });

    const after = await readFile(file, 'utf8');
    expect(after).toBe(before);
  });

  it('reports `changed: true` on the first stamp and `changed: false` on a no-op replace', async () => {
    await writeEventFile('OrderPlaced', '## o\n\n<Footer />\n');
    const fixedSnap = snap({ 'order.placed': obs({ observedCount: 100 }) });

    const first = await stampCatalog({ snapshot: fixedSnap, catalogPath: dir });
    expect(first.updates[0]).toMatchObject({ action: 'insert', changed: true });

    // Re-running with the same data should be a no-op replace.
    const second = await stampCatalog({
      snapshot: fixedSnap,
      catalogPath: dir,
    });
    expect(second.updates[0]).toMatchObject({
      action: 'replace',
      changed: false,
    });
  });
});

describe('buildStampSummary', () => {
  it('rolls up inserts, replaces, skipped, and changed-files counts', () => {
    const summary = buildStampSummary(
      {
        updates: [
          {
            catalogId: 'A',
            snapshotName: 'a',
            filePath: '/x/a.mdx',
            action: 'insert',
            changed: true,
          },
          {
            catalogId: 'B',
            snapshotName: 'b',
            filePath: '/x/b.mdx',
            action: 'replace',
            changed: true,
          },
          {
            catalogId: 'C',
            snapshotName: 'c',
            filePath: '/x/c.mdx',
            action: 'replace',
            changed: false,
          },
        ],
        skips: [{ snapshotName: 'mystery', reason: 'no-catalog-match' }],
      },
      false,
    );
    expect(summary.spec).toBe(STAMP_SUMMARY_SPEC);
    expect(summary.dryRun).toBe(false);
    expect(summary.attempted).toBe(4); // 3 updates + 1 skip
    expect(summary.skipped).toBe(1);
    expect(summary.inserts).toBe(1);
    expect(summary.replaces).toBe(2);
    expect(summary.changedFiles).toBe(2);
    expect(summary.hadChanges).toBe(true);
  });

  it('hadChanges is false when every update was a no-op', () => {
    const summary = buildStampSummary(
      {
        updates: [
          {
            catalogId: 'A',
            snapshotName: 'a',
            filePath: '/x/a.mdx',
            action: 'replace',
            changed: false,
          },
        ],
        skips: [],
      },
      false,
    );
    expect(summary.hadChanges).toBe(false);
    expect(summary.changedFiles).toBe(0);
  });

  it('propagates dryRun into the summary', () => {
    const summary = buildStampSummary({ updates: [], skips: [] }, true);
    expect(summary.dryRun).toBe(true);
  });
});
