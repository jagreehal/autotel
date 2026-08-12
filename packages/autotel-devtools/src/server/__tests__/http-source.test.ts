import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DevtoolsServer } from '../server';
import { attachDevtoolsRoutes } from '../http';
import { createDevtools, type DevtoolsInstance } from '../../index';

// GET /source is the only route that reads the developer's disk, so its tests
// are mostly about what it refuses.

let root: string;
let base: string;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'devtools-http-source-'));
  root = path.join(base, 'project');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'carrier.ts'),
    ['a', 'b', 'c', 'd', 'e', 'f'].join('\n') + '\n',
  );
  writeFileSync(path.join(base, 'creds.env'), 'TOKEN=hunter2\n');
});

// File-level, not per-describe: the fixture is shared, and tearing it down at
// the end of the first block left the next one reading a directory that no
// longer existed — passing for the wrong reason, since "missing" is also 404.
afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

describe('GET /source', () => {
  let server: Server | null = null;
  let devtools: DevtoolsServer | null = null;

  afterEach(async () => {
    if (devtools) await devtools.close();
    else if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    devtools = null;
  });

  // No default value: `start(undefined)` would silently select it, which is
  // exactly how the "disabled" case ended up testing the enabled one.
  async function start(sourceRoot: string | undefined) {
    devtools = new DevtoolsServer();
    server = createServer();
    attachDevtoolsRoutes(server, devtools, { sourceRoot });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    return `http://127.0.0.1:${addr.port}`;
  }

  it('returns the window of lines around the requested line', async () => {
    const url = await start(root);

    const res = await fetch(
      `${url}/source?file=${encodeURIComponent('src/carrier.ts')}&line=3&context=1`,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      file: 'src/carrier.ts',
      line: 3,
      startLine: 2,
      lines: ['b', 'c', 'd'],
    });
  });

  it('refuses to read outside the project root', async () => {
    const url = await start(root);

    const res = await fetch(
      `${url}/source?file=${encodeURIComponent('../creds.env')}&line=1`,
    );

    expect(res.status).toBe(404);
    await expect(res.text()).resolves.not.toContain('hunter2');
  });

  it('rejects a missing or non-numeric line', async () => {
    const url = await start(root);

    const missing = await fetch(
      `${url}/source?file=${encodeURIComponent('src/carrier.ts')}`,
    );
    expect(missing.status).toBe(400);

    const bogus = await fetch(
      `${url}/source?file=${encodeURIComponent('src/carrier.ts')}&line=abc`,
    );
    expect(bogus.status).toBe(400);
  });

  it('is disabled entirely when no source root is configured', async () => {
    const url = await start(undefined);

    const res = await fetch(
      `${url}/source?file=${encodeURIComponent('src/carrier.ts')}&line=3`,
    );

    expect(res.status).toBe(404);
  });
});

// The embedded path serves the same widget, which asks for source the same way,
// so it has to reach the same route — the wiring is the only thing that differs.
describe('createDevtools source access', () => {
  let instance: DevtoolsInstance | null = null;

  afterEach(async () => {
    if (instance) await instance.close();
    instance = null;
  });

  async function start(sourceRoot: string | false) {
    instance = createDevtools({ port: 0, host: '127.0.0.1', sourceRoot });
    const http = instance.httpServer;
    if (!http.listening) {
      await new Promise<void>((r) => http.once('listening', () => r()));
    }
    const addr = http.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    return `http://127.0.0.1:${addr.port}`;
  }

  it('serves source when given a root', async () => {
    const url = await start(root);

    const res = await fetch(
      `${url}/source?file=${encodeURIComponent('src/carrier.ts')}&line=1&context=0`,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ lines: ['a'] });
  });

  it('serves nothing when opted out', async () => {
    const url = await start(false);

    const res = await fetch(
      `${url}/source?file=${encodeURIComponent('src/carrier.ts')}&line=1`,
    );

    expect(res.status).toBe(404);
  });
});
