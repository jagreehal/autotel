import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logs, SeverityNumber } from '@opentelemetry/api';
import {
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { getLogger, init } from './init';
import { AutotelSdk, type AutotelSdkOptions } from './sdk';
import { logExportMode } from './log-export-mode';
import { emitOtelEvent, resetOtelEventWarningForTesting } from './otel-event';
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

  it('only events when logs are unset: plain log records wait for logs: true', async () => {
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

  it('events with logs unset, which export by default as on autotel-web', async () => {
    init({ service: 'debug-logs', debug: 'pretty', openFeature: false });

    const output = await printedOnce('checkout.started', () =>
      emitOtelEvent('checkout.started', { 'cart.items': 2 }),
    );

    expect(output).toContain('cart.items=2');
  });
});

describe('logs: false', () => {
  it('drops events too, and says so once', async () => {
    resetOtelEventWarningForTesting();
    init({ service: 'debug-logs', debug: 'pretty', logs: false });
    const warn = vi.spyOn(getLogger(), 'warn');
    const console = captureConsole();
    try {
      emitOtelEvent('checkout.started', {});
      emitOtelEvent('checkout.finished', {});
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(console.text()).not.toContain('checkout.started');
    } finally {
      console.release();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain('logs: false');
  });
});

describe('OTEL_LOGS_EXPORTER, when logs is unset', () => {
  afterEach(() => {
    delete process.env.OTEL_LOGS_EXPORTER;
  });

  it('=none turns log export off, events included, and warns', () => {
    process.env.OTEL_LOGS_EXPORTER = 'none';
    resetOtelEventWarningForTesting();
    init({ service: 'debug-logs', openFeature: false });
    const warn = vi.spyOn(getLogger(), 'warn');

    emitOtelEvent('checkout.started', {});

    expect(logExportMode()).toBe('off');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('=otlp leaves export to the SDK, even with debug on', () => {
    process.env.OTEL_LOGS_EXPORTER = 'otlp';
    let options: AutotelSdkOptions | undefined;
    init({
      service: 'debug-logs',
      debug: 'pretty',
      openFeature: false,
      sdkFactory: (defaults) => {
        options = defaults;
        return new AutotelSdk(defaults);
      },
    });

    expect(logExportMode()).toBe('env');
    // Any processor passed in would replace the SDK's own exporter.
    expect(options?.logRecordProcessors).toBeUndefined();
  });
});

describe('your own log processors', () => {
  it('get every record whatever logs says, plain logs included', async () => {
    const exporter = new InMemoryLogRecordExporter();
    init({
      service: 'debug-logs',
      openFeature: false,
      logRecordProcessors: [new SimpleLogRecordProcessor({ exporter })],
    });

    emitHello();
    emitOtelEvent('checkout.started', {});

    await expect
      .poll(() => exporter.getFinishedLogRecords().map((r) => r.body))
      .toEqual(['hello from the logs api', 'checkout.started']);
  });

  it('receive events with logs: false, so nothing warns of a drop', async () => {
    resetOtelEventWarningForTesting();
    const exporter = new InMemoryLogRecordExporter();
    init({
      service: 'debug-logs',
      logs: false,
      logRecordProcessors: [new SimpleLogRecordProcessor({ exporter })],
    });
    const warn = vi.spyOn(getLogger(), 'warn');

    emitOtelEvent('checkout.started', {});

    await expect.poll(() => exporter.getFinishedLogRecords()).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
