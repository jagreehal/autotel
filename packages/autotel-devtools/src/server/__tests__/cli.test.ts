import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve as pathResolve } from 'node:path';

const CLI_PATH = pathResolve(__dirname, '../../../dist/cli.js');
const PKG_DIR = pathResolve(__dirname, '../../../');

describe('CLI', () => {
  let proc: ChildProcess | null = null;

  afterEach(() => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
    proc = null;
  });

  it('prints help with --help', async () => {
    const output = await runCli(['--help']);
    expect(output).toContain('autotel-devtools');
    expect(output).toContain('--port');
    expect(output).toContain('[port]'); // positional shorthand is documented
    expect(output).toContain('/v1/traces');
    expect(output).toContain('widget.js');
  });

  it('documents the store flags, which persistence is useless without', async () => {
    const output = await runCli(['--help']);
    expect(output).toContain('--db');
    expect(output).toContain('--max-traces');
    // The default has to be stated: an in-memory default that looks persistent
    // is how someone loses a session they assumed was on disk.
    expect(output).toMatch(/in-memory/i);
  });

  it('prints version with --version', async () => {
    const output = await runCli(['--version']);
    // Output may contain npm warnings on stderr; extract the last non-empty line
    const lines = output
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const versionLine = lines[lines.length - 1];
    expect(versionLine).toMatch(/^\d+\.\d+\.\d+$|^unknown$/);
  });

  it('starts server on specified port', async () => {
    const port = 9123 + Math.floor(Math.random() * 100);
    proc = spawn(process.execPath, [CLI_PATH, '-p', String(port)], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const output = await waitForOutput(proc, 'OTLP', 5000);
    expect(output).toContain(String(port));

    await expectDevtoolsOn(reportedPort(output));
  });

  it('accepts port as the first positional argument', async () => {
    const port = 9223 + Math.floor(Math.random() * 100);
    proc = spawn(process.execPath, [CLI_PATH, String(port)], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const output = await waitForOutput(proc, 'OTLP', 5000);
    expect(output).toContain(String(port));

    await expectDevtoolsOn(reportedPort(output));
  });

  it('combines positional port with --host', async () => {
    const port = 9323 + Math.floor(Math.random() * 100);
    proc = spawn(
      process.execPath,
      [CLI_PATH, String(port), '-H', '127.0.0.1'],
      {
        cwd: PKG_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const output = await waitForOutput(proc, 'OTLP', 5000);
    expect(output).toContain(String(port));

    await expectDevtoolsOn(reportedPort(output));
  });

  it('rejects invalid port with non-zero exit', async () => {
    const child = spawn(process.execPath, [CLI_PATH, 'not-a-port'], {
      cwd: PKG_DIR,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const exitCode: number = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code ?? -1));
      setTimeout(() => {
        child.kill();
        resolve(-1);
      }, 3000);
    });
    expect(exitCode).not.toBe(0);
  });

  it('falls forward to the next free port when the requested one is taken', async () => {
    const port = 9523 + Math.floor(Math.random() * 100);
    // Occupy the requested port before launching the CLI.
    const blocker = spawn(
      process.execPath,
      [
        '-e',
        `require('http').createServer().listen(${port}, '127.0.0.1', () => console.log('listening'))`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    // Wait for the bind, not for a guess at how long a bind takes: the CLI
    // only falls forward if the port is genuinely taken by the time it starts.
    await waitForOutput(blocker, 'listening', 5000);

    try {
      proc = spawn(process.execPath, [CLI_PATH, String(port)], {
        cwd: PKG_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Wait for the port-fallback warning — it's printed AFTER the URL
      // block, so we get the full startup output in one go.
      const output = await waitForOutput(proc, 'was busy', 5000);
      expect(output).toMatch(new RegExp(`port ${port} was busy`));
      // The reported UI URL should be on a different port (port+1, since we
      // only block one port).
      expect(output).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
      const actual = Number(output.match(/http:\/\/127\.0\.0\.1:(\d+)/)![1]);
      expect(actual).toBeGreaterThan(port);

      await expectDevtoolsOn(actual);
    } finally {
      blocker.kill('SIGTERM');
    }
  });

  /**
   * The port the CLI says it bound, which is not the requested one when that
   * port was busy and it fell forward.
   */
  function reportedPort(output: string): number {
    const match = output.match(
      /http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/,
    );
    expect(match).not.toBeNull();
    return Number(match![1]);
  }

  /**
   * Devtools answering, not merely something answering.
   *
   * A port chosen by number can be held by anything on a developer's machine
   * or a busy CI box, and a stranger's 404 there should not read as the CLI
   * failing to start. The identity header is what tells the two apart. The
   * retry covers the gap between the CLI printing its URL and the listener
   * accepting connections.
   */
  async function expectDevtoolsOn(port: number): Promise<void> {
    await vi.waitFor(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`);
        expect(res.status).toBe(200);
        expect(res.headers.get('x-autotel-devtools')).toBeTruthy();
      },
      { timeout: 5000, interval: 100 },
    );
  }

  function runCli(args: string[]): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, ...args], {
        cwd: PKG_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', (d) => (output += d.toString()));
      child.stderr?.on('data', (d) => (output += d.toString()));
      child.on('close', () => resolve(output));
      setTimeout(() => {
        child.kill();
        resolve(output);
      }, 3000);
    });
  }

  function waitForOutput(
    child: ChildProcess,
    substring: string,
    timeout: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for "${substring}"`)),
        timeout,
      );
      child.stdout?.on('data', (data) => {
        output += data.toString();
        if (output.includes(substring)) {
          clearTimeout(timer);
          resolve(output);
        }
      });
      child.stderr?.on('data', (data) => {
        output += data.toString();
        if (output.includes(substring)) {
          clearTimeout(timer);
          resolve(output);
        }
      });
    });
  }
});
