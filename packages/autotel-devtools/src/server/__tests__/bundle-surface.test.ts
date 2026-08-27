/**
 * Which bundle each surface is served.
 *
 * Two browser bundles are built: the full-page viewer with every view, and a
 * reduced one for embedding in someone else's product page. Serving the wrong
 * one is a silent failure — the UI still works, it is just the wrong size, so
 * nothing would surface it except this test. Handing an embedder the full
 * bundle ships them exactly the code the split exists to spare them.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevtoolsServer } from '../server';
import { attachDevtoolsRoutes } from '../http';

let server: Server | null = null;
let devtools: DevtoolsServer | null = null;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'autotel-bundles-'));
});

afterEach(async () => {
  if (devtools) await devtools.close();
  else if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  devtools = null;
  rmSync(dir, { recursive: true, force: true });
});

async function start(): Promise<number> {
  server = createServer();
  devtools = new DevtoolsServer({ server });
  attachDevtoolsRoutes(server, devtools);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return (server.address() as { port: number }).port;
}

async function fetchWidget(port: number, query = ''): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/widget.js${query}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/javascript/);
  return res.text();
}

describe('GET /widget.js', () => {
  it('serves a bundle for the embedded surface', async () => {
    const port = await start();
    const body = await fetchWidget(port);
    expect(body.length).toBeGreaterThan(0);
  });

  it('serves a bundle for the full-page surface', async () => {
    const port = await start();
    const body = await fetchWidget(port, '?mode=fullpage');
    expect(body.length).toBeGreaterThan(0);
  });

  it('serves the two surfaces from different files when both are built', async () => {
    // Verified against the real dist: if both bundles exist, the two URLs must
    // not return identical bytes, or the split is not being applied.
    const port = await start();
    const widget = await fetchWidget(port);
    const fullpage = await fetchWidget(port, '?mode=fullpage');

    const missing = widget.startsWith('// widget bundle not found');
    if (missing) return; // Unbuilt checkout — nothing to compare.
    expect(fullpage).not.toBe(widget);
    // The full-page bundle carries strictly more views, so it is larger.
    expect(fullpage.length).toBeGreaterThan(widget.length);
  });

  it('serves the full-page HTML asking for the full-page bundle', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const html = await res.text();
    expect(html).toContain('mode=fullpage');
  });
});
