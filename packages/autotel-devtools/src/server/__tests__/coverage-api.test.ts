/**
 * Instrumentation coverage over the wire.
 *
 * The map file is produced by `autotel map` and committed, so the server reads
 * it off disk the way `GET /source` reads source, under the same root.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevtoolsServer } from '../server';
import { attachDevtoolsRoutes } from '../http';

let server: Server | null = null;
let devtools: DevtoolsServer | null = null;
let dir: string | null = null;

afterEach(async () => {
  if (devtools) await devtools.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  server = null;
  devtools = null;
  dir = null;
});

async function start(map?: unknown): Promise<number> {
  dir = mkdtempSync(join(tmpdir(), 'autotel-coverage-'));
  if (map) writeFileSync(join(dir, 'autotel.map.json'), JSON.stringify(map));
  server = createServer();
  devtools = new DevtoolsServer({ server });
  attachDevtoolsRoutes(server, devtools, { sourceRoot: dir });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

const MAP = {
  routes: [
    { method: 'GET', path: '/users', file: 'src/routes/users.ts' },
    { method: 'POST', path: '/orders', file: 'src/routes/orders.ts' },
  ],
};

async function ingestNamed(port: number, name: string): Promise<void> {
  const base = BigInt(Date.now() - 1000) * 1_000_000n;
  const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'api' } },
            ],
          },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId: 'a'.repeat(32),
                  spanId: 'b'.repeat(16),
                  name,
                  kind: 2,
                  startTimeUnixNano: base.toString(),
                  endTimeUnixNano: (base + 1_000_000n).toString(),
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
}

describe('GET /api/coverage', () => {
  it('reports which mapped entry points have emitted nothing', async () => {
    const port = await start(MAP);
    await ingestNamed(port, 'GET /users');

    const body = await (
      await fetch(`http://127.0.0.1:${port}/api/coverage`)
    ).json();

    expect(body.total).toBe(2);
    expect(body.seenCount).toBe(1);
    // Unseen first, so the thing you came to find is at the top.
    expect(body.entries[0].path).toBe('/orders');
    expect(body.entries[0].seen).toBe(false);
    expect(body.entries[0].file).toBe('src/routes/orders.ts');
  });

  it('says the map is missing rather than reporting perfect coverage', async () => {
    // Zero routes and zero unseen routes look identical in a count. Reporting
    // "0 of 0" as a pass would tell someone their app is fully instrumented
    // when the truth is that nothing has ever scanned it.
    const port = await start();

    const res = await fetch(`http://127.0.0.1:${port}/api/coverage`);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.message).toContain('autotel-cli map');
  });

  it('flags a map older than the source it describes', async () => {
    const port = await start(MAP);
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(dir!, 'autotel.map.json'), old, old);
    // A build output newer than the map says nothing about the source.
    mkdirSync(join(dir!, 'dist'));
    writeFileSync(join(dir!, 'dist', 'index.js'), '');
    let body = await (
      await fetch(`http://127.0.0.1:${port}/api/coverage`)
    ).json();
    expect(body.freshness.status).toBe('fresh');

    mkdirSync(join(dir!, 'src', 'routes'), { recursive: true });
    writeFileSync(join(dir!, 'src', 'routes', 'refunds.ts'), '');
    body = await (await fetch(`http://127.0.0.1:${port}/api/coverage`)).json();
    expect(body.freshness).toMatchObject({
      status: 'stale',
      newerFile: join('src', 'routes', 'refunds.ts'),
    });
  });
});

describe('GET /api/agents/usage', () => {
  it('answers what the last prompt in a repository spent, and how complete that is', async () => {
    const port = await start();
    const log = (attrs: Record<string, string | number>) => ({
      timeUnixNano: `${Date.now()}000000`,
      attributes: Object.entries(attrs).map(([key, value]) => ({
        key,
        value:
          typeof value === 'number'
            ? { intValue: String(value) }
            : { stringValue: value },
      })),
    });
    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'codex_cli_rs' } },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  log({
                    'event.name': 'autotel.agent.repository',
                    'session.id': 'conv-1',
                    'agent.kind': 'codex',
                    'repository.name': 'autotel',
                  }),
                  log({
                    'event.name': 'codex.sse_event',
                    'event.kind': 'response.completed',
                    'conversation.id': 'conv-1',
                    'turn.id': 'turn-1',
                    model: 'gpt-5-codex',
                    input_token_count: 100,
                    output_token_count: 10,
                  }),
                ],
              },
            ],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const body = await (
      await fetch(
        `http://127.0.0.1:${port}/api/agents/usage?repository=autotel&latest=prompt`,
      )
    ).json();
    expect(body.sessions[0]).toMatchObject({
      id: 'conv-1',
      agent: 'codex',
      latestPromptId: 'turn-1',
    });
    expect(body.total).toMatchObject({ requests: 1, inputTokens: 100 });
    // Codex reports no cost and no OpenAI model is priced.
    expect(body.cost).toBe('unknown');
    expect(body.tokens).toBe('complete');
  });
});
