import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  test,
  expect,
  beforeAll,
  afterAll,
  describe,
} from '../src/index';
import { injectTraceContext } from 'autotel/http';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3399';
let serverProcess: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server is not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  throw new Error(`Server did not become ready within ${timeoutMs}ms: ${url}`);
}

beforeAll(async () => {
  const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
  serverProcess = spawn(process.execPath, [serverPath], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  serverProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  await waitForServer(`${apiBase}/health`);
}, 20_000);

afterAll(async () => {
  if (!serverProcess) return;
  if (serverProcess.killed) return;

  await new Promise<void>((resolve) => {
    serverProcess?.once('exit', () => resolve());
    serverProcess?.kill('SIGTERM');
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
      resolve();
    }, 2_000);
  });
});

describe('autotel-vitest compatibility integration', () => {
  test('GET /health works', async () => {
    const res = await fetch(`${apiBase}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('injectTraceContext + POST /users works', async () => {
    const headers = injectTraceContext({ 'content-type': 'application/json' });
    const res = await fetch(`${apiBase}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'new-1', name: 'Alice' });
  });

  test('error route returns 500', async () => {
    const res = await fetch(`${apiBase}/error`);
    expect(res.status).toBe(500);
  });

  test('failing branch is captured by fixture as an error', async () => {
    await expect(async () => {
      const res = await fetch(`${apiBase}/error`);
      expect(res.status).toBe(200);
    }).rejects.toThrow();
  });
});
