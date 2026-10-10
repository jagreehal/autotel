import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMap } from './map';
import type { MapFile } from '../lib/map/types';
import type { MapOptions } from '../types/index';

const roots: string[] = [];

/* The runner sets GITHUB_WORKSPACE, which rebases every path; pin it so the
   tests read the same on CI as locally. */
beforeEach(() => vi.stubEnv('GITHUB_WORKSPACE', ''));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const SOURCE = `import { Hono } from 'hono';

const app = new Hono();

app.get('/users/:id', async (c) => c.json({ id: c.req.param('id') }));
app.post('/payments/charge', async (c) => c.json({ ok: true }));
app.get('/orders', async (c) => c.json([]));
`;

function project(source = SOURCE): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autotel-map-gh-'));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      dependencies: { hono: '^4.0.0', autotel: '^1.0.0' },
    }),
  );
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), source);
  return root;
}

function run(cwd: string, flags: Partial<MapOptions> = {}): string[] {
  const out: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    out.push(chunk);
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  runMap({
    cwd,
    dryRun: false,
    noInstall: false,
    printInstallCmd: false,
    verbose: false,
    quiet: false,
    workspaceRoot: false,
    all: false,
    write: false,
    json: false,
    ...flags,
  });
  vi.restoreAllMocks();
  return out.join('').trim().split('\n');
}

describe('map --format github', () => {
  it('leads with a notice, then warns once per failing requirement', () => {
    const lines = run(project(), { format: 'github' });

    const warnings = lines.filter((line) => line.startsWith('::warning'));
    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) {
      expect(warning).toMatch(
        /^::warning file=src\/index\.ts,line=\d+,title=autotel map%3A [a-z-]+::\S/,
      );
    }
    /* The sensitive payments route loses double points, so it leads. */
    expect(warnings[0]).toContain('line=6,');
    expect(lines.some((line) => line.startsWith('::error'))).toBe(false);
    expect(lines[0]).toMatch(
      /^::notice title=autotel map::score \d+\/100 \([a-z-]+\): 0 instrumented, \d+ partial, \d+ dark$/,
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('stops at --limit and says how many were left out', () => {
    const lines = run(project(), { format: 'github', limit: '1' });

    expect(lines.filter((line) => line.startsWith('::warning'))).toHaveLength(
      1,
    );
    expect(lines[0]).toMatch(/; \d+ more findings? not shown$/);
  });

  it('emits only the regressions, as errors, against a baseline', () => {
    const cwd = project();
    const json = run(cwd, { json: true }).join('\n');
    const current = (JSON.parse(json) as { map: MapFile }).map;
    /* A baseline in which /orders passed trace: the scan now fails it. */
    const orders = current.routes.find((route) => route.path === '/orders')!;
    orders.checks.trace = { status: 'pass' };
    fs.writeFileSync(
      path.join(cwd, 'autotel.map.json'),
      JSON.stringify(current),
    );

    const lines = run(cwd, { format: 'github', baseline: true });

    expect(lines.filter((line) => line.startsWith('::warning'))).toHaveLength(
      0,
    );
    expect(lines.filter((line) => line.startsWith('::error file='))).toEqual([
      expect.stringMatching(
        /^::error file=src\/index\.ts,line=7,title=autotel map%3A trace::/,
      ),
    ]);
    expect(lines[0]).toMatch(
      /^::error title=autotel map::score .*; regressed against autotel\.map\.json$/,
    );
    expect(process.exitCode).toBe(1);
  });

  it('turns a score under --min-score into an error and exits 1', () => {
    const lines = run(project(), { format: 'github', minScore: '100' });

    expect(lines[0]).toMatch(
      /^::error title=autotel map::score \d+\/100 .*; below --min-score 100$/,
    );
    expect(process.exitCode).toBe(1);
  });

  it('rebases paths on GITHUB_WORKSPACE', () => {
    const cwd = project();
    vi.stubEnv('GITHUB_WORKSPACE', path.dirname(cwd));

    const lines = run(cwd, { format: 'github' });

    expect(lines[1]).toContain(`file=${path.basename(cwd)}/src/index.ts,`);
  });

  it('escapes properties', () => {
    const cwd = project();
    vi.stubEnv('GITHUB_WORKSPACE', path.dirname(cwd));
    const dir = path.join(path.dirname(cwd), 'a,b:c');
    fs.renameSync(cwd, dir);
    roots.push(dir);

    const lines = run(dir, { format: 'github' });

    /* An unescaped , or : would end the property early. */
    expect(lines[1]).toContain('file=a%2Cb%3Ac/src/index.ts,');
  });

  it('treats --format json as --json, and refuses both with another format', () => {
    const cwd = project();
    expect(JSON.parse(run(cwd, { format: 'json' }).join('\n')).command).toBe(
      'map',
    );
    expect(() => run(cwd, { json: true, format: 'github' })).toThrow(
      /--json and --format github both claim stdout/,
    );
    expect(() => run(cwd, { format: 'sarif' })).toThrow(/Unknown --format/);
  });

  it.each(['0', 'abc', '2.5'])(
    'rejects --limit %s instead of falling back to the default',
    (limit) => {
      expect(() => run(project(), { format: 'github', limit })).toThrow(
        /--limit expects a whole number/,
      );
    },
  );
});
