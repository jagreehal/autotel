import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { encodeOtlpRequest } from 'autotel-devtools/otlp-proto';

/**
 * vitest resolves `protobufjs` differently from Node, so this runs the built
 * server the way `npx autotel-mcp` does. CI builds before testing; locally it
 * builds when `dist/` is missing.
 */
const packageRoot = resolve(__dirname, '..');

/** The server logs its configured port, so `0` would not say where it landed. */
function freePort(): Promise<number> {
  return new Promise((found) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      // SAFETY: a TCP listen always reports an AddressInfo.
      const { port } = probe.address() as AddressInfo;
      probe.close(() => found(port));
    });
  });
}

describe('built server: OTLP/protobuf under real Node', () => {
  let server: ChildProcess | undefined;

  beforeAll(() => {
    if (!existsSync(resolve(packageRoot, 'dist/server.js'))) {
      execFileSync('pnpm', ['build'], { cwd: packageRoot, stdio: 'inherit' });
    }
  }, 180_000);

  afterEach(() => {
    server?.kill();
  });

  it('accepts a protobuf export', async () => {
    const port = await freePort();
    const running = spawn('node', [resolve(packageRoot, 'bin/autotel-mcp')], {
      env: { ...process.env, AUTOTEL_COLLECTOR_PORT: `${port}` },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    server = running;
    await new Promise<void>((listening, failed) => {
      let output = '';
      running.stderr?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('OTLP receiver on')) listening();
      });
      running.on('exit', () => failed(new Error(`server exited: ${output}`)));
    });

    const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: encodeOtlpRequest('traces', { resourceSpans: [] }),
    });

    expect(res.status).toBe(200);
  }, 30_000);
});
