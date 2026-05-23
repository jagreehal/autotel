// End-to-end tests for the CLI dispatcher. These run the compiled
// dist/cli.js as a subprocess against fixture inputs — the same shape a
// CI step or a user shell would invoke.
//
// Unit tests in cli.ts would test each branch in isolation; these tests
// verify the wiring between branches and exit codes. They catch the bug
// class fixed in PR ("the action invoked the CLI without --fail-on-drift,
// so exit code stayed 0 regardless of drift").
//
// Requires `dist/cli.js` to exist (run `pnpm build` first). The
// `pnpm test:e2e` script does this for you.

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ARCHITECTURE_SNAPSHOT_SPEC } from 'autotel-subscribers/architecture-snapshot';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'cli.js');

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runCli(args: string[]): CliResult {
  const result = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Tiny fixture builder — a snapshot file + a minimal catalog tree. */
function buildFixture(opts: {
  /** Snapshot events keyed by event name. */
  events: Record<
    string,
    {
      fields: string[];
      producer?: string;
      channel?: string;
    }
  >;
  /** Catalog events to write as <root>/events/<id>/index.mdx files. */
  catalogEvents: Array<{ id: string; declaredFields?: string[] }>;
}): { snapshotPath: string; catalogPath: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'autotel-cli-e2e-'));
  const catalogPath = join(root, 'catalog');
  mkdirSync(catalogPath, { recursive: true });

  const snapshot = {
    spec: ARCHITECTURE_SNAPSHOT_SPEC,
    generatedAt: '2026-05-22T00:00:00.000Z',
    service: 'fixture',
    events: Object.fromEntries(
      Object.entries(opts.events).map(([name, e]) => [
        name,
        {
          name,
          observedCount: 3,
          firstSeen: '2026-05-22T00:00:00.000Z',
          lastSeen: '2026-05-22T00:00:00.000Z',
          fieldPaths: e.fields,
          sampleTraceIds: [],
          ...(e.producer ? { producer: e.producer } : {}),
          ...(e.channel ? { channel: e.channel } : {}),
        },
      ]),
    ),
  };
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  for (const ev of opts.catalogEvents) {
    const dir = join(catalogPath, 'events', ev.id);
    mkdirSync(dir, { recursive: true });
    const frontmatter = ev.declaredFields
      ? `---\nid: ${ev.id}\nversion: 1.0.0\nschemaPath: schema.json\n---\n`
      : `---\nid: ${ev.id}\nversion: 1.0.0\n---\n`;
    writeFileSync(join(dir, 'index.mdx'), frontmatter + '\n## Overview\n');
    if (ev.declaredFields) {
      const schema = {
        type: 'object',
        properties: Object.fromEntries(
          ev.declaredFields.map((f) => [f, { type: 'string' }]),
        ),
      };
      writeFileSync(join(dir, 'schema.json'), JSON.stringify(schema, null, 2));
    }
  }

  return { snapshotPath, catalogPath, root };
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(
      `CLI not built: ${CLI}\nRun \`pnpm build\` before \`pnpm test:e2e\`.`,
    );
  }
});

describe('cli e2e — drift', () => {
  it('exits 0 with --fail-on-drift when catalog and runtime agree', () => {
    const { snapshotPath, catalogPath } = buildFixture({
      events: { 'order.placed': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced', declaredFields: ['orderId'] }],
    });
    const res = runCli([
      'drift',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
      '--fail-on-drift',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('No drift detected');
    expect(res.stderr).toContain('No drift detected');
  });

  it('exits 1 with --fail-on-drift when drift exists', () => {
    const { snapshotPath, catalogPath } = buildFixture({
      events: { 'order.cancelled': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced' }],
    });
    const res = runCli([
      'drift',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
      '--fail-on-drift',
    ]);
    expect(res.exitCode).toBe(1);
    expect(res.stdout).toContain('Architecture drift report');
    expect(res.stderr).toMatch(/Drift detected/);
  });

  it('exits 0 WITHOUT --fail-on-drift even when drift exists', () => {
    const { snapshotPath, catalogPath } = buildFixture({
      events: { 'order.cancelled': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced' }],
    });
    const res = runCli([
      'drift',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Architecture drift report');
    // Drift outcome line is still printed to stderr — the gating just doesn't fire.
    expect(res.stderr).toMatch(/Drift detected/);
  });

  it('exits 2 when --policy new-only is set without --base-snapshot', () => {
    const { snapshotPath, catalogPath } = buildFixture({
      events: { 'order.placed': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced' }],
    });
    const res = runCli([
      'drift',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
      '--policy',
      'new-only',
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('--policy new-only requires --base-snapshot');
  });

  it('outputs versioned JSON when --format json is set', () => {
    const { snapshotPath, catalogPath } = buildFixture({
      events: { 'order.placed': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced' }],
    });
    const res = runCli([
      'drift',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
      '--format',
      'json',
    ]);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.spec).toBe('autotel-eventcatalog-report/v0.1.0');
    expect(parsed.mode).toBe('all');
    expect(parsed.report.snapshotService).toBe('fixture');
  });

  it('errors clearly when given an unknown flag', () => {
    const { snapshotPath, catalogPath } = buildFixture({
      events: { 'order.placed': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced' }],
    });
    const res = runCli([
      'drift',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
      '--made-up-flag',
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Unknown argument');
  });
});

describe('cli e2e — stamp', () => {
  it('dry-run leaves files untouched', () => {
    const { snapshotPath, catalogPath } = buildFixture({
      events: { 'order.placed': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced' }],
    });
    const res = runCli([
      'stamp',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
      '--dry-run',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/would insert OrderPlaced/);
  });

  it('writes a versioned summary JSON when --summary-output is given', () => {
    const { snapshotPath, catalogPath, root } = buildFixture({
      events: { 'order.placed': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced' }],
    });
    const summaryPath = join(root, 'stamp-summary.json');

    const res = runCli([
      'stamp',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
      '--summary-output',
      summaryPath,
    ]);
    expect(res.exitCode).toBe(0);

    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    expect(summary.spec).toBe('autotel-eventcatalog-stamp-summary/v0.1.0');
    expect(summary.hadChanges).toBe(true);
    expect(summary.inserts).toBe(1);
    expect(summary.changedFiles).toBe(1);
  });

  it('summary.hadChanges is false when re-stamping is a no-op', () => {
    const { snapshotPath, catalogPath, root } = buildFixture({
      events: { 'order.placed': { fields: ['orderId'] } },
      catalogEvents: [{ id: 'OrderPlaced' }],
    });

    // First stamp writes the block.
    runCli(['stamp', '--snapshot', snapshotPath, '--catalog', catalogPath]);

    // Second stamp with identical input is a no-op.
    const summaryPath = join(root, 'stamp-summary-2.json');
    const res = runCli([
      'stamp',
      '--snapshot',
      snapshotPath,
      '--catalog',
      catalogPath,
      '--summary-output',
      summaryPath,
    ]);
    expect(res.exitCode).toBe(0);
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    expect(summary.hadChanges).toBe(false);
    expect(summary.changedFiles).toBe(0);
    expect(summary.replaces).toBe(1);
  });
});

describe('cli e2e — top-level', () => {
  it('exits 2 with usage on no command', () => {
    const res = runCli([]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Usage');
  });

  it('exits 2 on unknown command', () => {
    const res = runCli(['rumpus']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Usage');
  });
});
