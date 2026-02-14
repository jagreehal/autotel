import { spawn, type ChildProcess } from 'node:child_process';
import {
  test,
  expect,
  beforeAll,
  afterAll,
  describe,
} from 'autotel-vitest';
import { injectTraceContext } from 'autotel/http';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';

let serverProcess: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Server did not become ready within ${timeoutMs}ms: ${url}`);
}

beforeAll(async () => {
  serverProcess = spawn('node', ['server.mjs'], {
    cwd: new URL('../../', import.meta.url),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
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

describe('vitest e2e api coverage', () => {
  test('GET /health returns 200', async () => {
    const res = await fetch(`${apiBase}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('GET /users/:id returns user', async () => {
    const res = await fetch(`${apiBase}/users/user-42`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'user-42', name: 'User user-42' });
  });

  test('GET /error returns 500', async () => {
    const res = await fetch(`${apiBase}/error`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'intentional server error');
  });

  test('non-existent route returns 404', async () => {
    const res = await fetch(`${apiBase}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  test('injectTraceContext + GET /health works', async () => {
    const headers = injectTraceContext({});
    const res = await fetch(`${apiBase}/health`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('injectTraceContext + POST /users creates user', async () => {
    const headers = injectTraceContext({ 'content-type': 'application/json' });
    const res = await fetch(`${apiBase}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'new-1', name: 'Alice' });
  });

  test('records a failing expectation as test-span error', async () => {
    await expect(async () => {
      const res = await fetch(`${apiBase}/error`);
      expect(res.status).toBe(200);
    }).rejects.toThrow();
  });
});
