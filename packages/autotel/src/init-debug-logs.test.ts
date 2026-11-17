import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logs, SeverityNumber } from '@opentelemetry/api';
import { init } from './init';
import { shutdown } from './shutdown';

/** Lines written to the console, captured until `release()` is called. */
function captureConsole() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((arg) => inspect(arg, { depth: 5 })).join(' '));
  };
  const log = vi.spyOn(console, 'log').mockImplementation(record);
  // ConsoleLogRecordExporter writes with console.dir.
  const dir = vi.spyOn(console, 'dir').mockImplementation(record);
  return {
    text: () => lines.join('\n'),
    release: () => {
      log.mockRestore();
      dir.mockRestore();
    },
  };
}

/**
 * The console output once `expected` shows up. A record is exported only
 * after the resource's async attributes settle, so it is never synchronous.
 */
async function printedOnce(expected: string, run: () => void): Promise<string> {
  const console = captureConsole();
  try {
    run();
    await expect.poll(console.text).toContain(expected);
    return console.text();
  } finally {
    console.release();
  }
}

function emitHello(): void {
  logs.getLogger('debug-logs-test').emit({
    severityNumber: SeverityNumber.WARN,
    severityText: 'WARN',
    body: 'hello from the logs api',
    attributes: { 'log.type': 'custom' },
  });
}

afterEach(async () => {
  await shutdown();
  logs.disable();
});

describe('debug prints log records', () => {
  it('as one line each in pretty mode, with no endpoint configured', async () => {
    init({ service: 'debug-logs', logs: true, debug: 'pretty' });

    const output = await printedOnce('hello from the logs api', emitHello);

    expect(output).toContain('WARN');
    expect(output).toContain('log.type=custom');
  });

  it('as the raw console exporter record with debug: true', async () => {
    init({ service: 'debug-logs', logs: true, debug: true });

    const output = await printedOnce('hello from the logs api', emitHello);

    expect(output).toContain('severityText');
  });

  it('not at all unless logs are on: debug alone stays about spans', async () => {
    // Installed OpenFeature turns logs on by itself (its evaluations are log
    // events), and this repo has it; rule it out so "no logs" means no logs.
    init({ service: 'debug-logs', debug: 'pretty', openFeature: false });
    const console = captureConsole();
    try {
      emitHello();
      // Long past the point a printed record would have appeared.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(console.text()).not.toContain('hello from the logs api');
    } finally {
      console.release();
    }
  });

  it('redacted, like every other place a log record goes', async () => {
    init({
      service: 'debug-logs',
      logs: true,
      debug: 'pretty',
      attributeRedactor: 'default',
    });

    const output = await printedOnce('signup', () =>
      logs.getLogger('debug-logs-test').emit({
        body: 'signup',
        attributes: { 'user.email': 'person@example.com' },
      }),
    );

    expect(output).not.toContain('person@example.com');
  });
});
