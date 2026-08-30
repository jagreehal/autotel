// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureExporter,
  pendingLogCount,
  recordEvent,
  recordLog,
  resetForTesting,
  setRawFetch,
} from './span-exporter';
import { captureConsoleAsLogs } from './browser-logs';
import { resetSessionForTesting } from './session';

let fetchMock: ReturnType<typeof vi.fn>;
let stop: (() => void) | undefined;

function sentBodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls.map(
    ([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  resetForTesting();
  resetSessionForTesting();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  setRawFetch(fetchMock as unknown as typeof globalThis.fetch);
  configureExporter('web', 'https://collector.example.com', false);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  resetForTesting();
  vi.useRealTimers();
});

describe('browser logs over OTLP', () => {
  it('posts log records to the logs endpoint, not the traces one', async () => {
    recordLog('warn', 'disk almost full');
    await vi.advanceTimersByTimeAsync(0);
    const urls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(urls).toContain('https://collector.example.com/v1/logs');
    expect(urls).not.toContain('https://collector.example.com/v1/traces');
  });

  it('sends an OTLP resourceLogs envelope', async () => {
    recordLog('error', 'checkout failed');
    await vi.advanceTimersByTimeAsync(0);
    const [body] = sentBodies();
    const record = (body.resourceLogs as never[])[0] as {
      scopeLogs: { logRecords: Record<string, unknown>[] }[];
    };
    const entry = record.scopeLogs[0].logRecords[0];
    expect(entry.severityText).toBe('ERROR');
    expect(entry.severityNumber).toBe(17);
    expect(entry.body).toEqual({ stringValue: 'checkout failed' });
    expect(entry.timeUnixNano).toMatch(/^\d+$/);
  });

  it('carries the session so a log joins the spans around it', async () => {
    recordLog('info', 'hello');
    await vi.advanceTimersByTimeAsync(0);
    const body = sentBodies()[0];
    const entry = (
      (body.resourceLogs as never[])[0] as {
        scopeLogs: { logRecords: { attributes: { key: string }[] }[] }[];
      }
    ).scopeLogs[0].logRecords[0];
    expect(entry.attributes.map((a) => a.key)).toContain('session.id');
  });

  it('retries logs the same way it retries spans', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    recordLog('warn', 'x');
    await vi.advanceTimersByTimeAsync(0);
    expect(pendingLogCount()).toBe(1);

    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pendingLogCount()).toBe(0);
  });

  it('does nothing when no endpoint is configured', () => {
    resetForTesting();
    recordLog('warn', 'x');
    expect(pendingLogCount()).toBe(0);
  });
});

describe('console capture', () => {
  it('turns console output into log records', async () => {
    stop = captureConsoleAsLogs({});
    console.warn('disk almost full', 91);
    await vi.advanceTimersByTimeAsync(0);

    const entry = (
      (sentBodies()[0].resourceLogs as never[])[0] as {
        scopeLogs: { scope: { name: string }; logRecords: Record<string, unknown>[] }[];
      }
    ).scopeLogs[0];
    // A distinct scope, so auto-captured output can be told apart from logs the
    // application meant to send.
    expect(entry.scope.name).toBe('console');
    expect(entry.logRecords[0].body).toEqual({
      stringValue: 'disk almost full 91',
    });
  });

  it('still calls through to the real console', () => {
    const seen: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => seen.push(args);
    stop = captureConsoleAsLogs({});
    console.warn('hello');
    stop?.();
    console.warn = original;
    expect(seen).toEqual([['hello']]);
  });

  it('honours a minimum level', async () => {
    stop = captureConsoleAsLogs({ minLevel: 'warn' });
    console.log('chatter');
    console.error('real');
    await vi.advanceTimersByTimeAsync(0);
    const records = sentBodies().flatMap(
      (body) =>
        (
          (body.resourceLogs as never[])[0] as {
            scopeLogs: { logRecords: unknown[] }[];
          }
        ).scopeLogs[0].logRecords,
    );
    expect(records).toHaveLength(1);
  });

  it('restores the console on teardown', () => {
    const before = console.error;
    stop = captureConsoleAsLogs({});
    expect(console.error).not.toBe(before);
    stop?.();
    expect(console.error).toBe(before);
  });
});

describe('ambient enrichment never overwrites an explicit attribute', () => {
  it('keeps a session id the caller supplied', () => {
    recordEvent('session.end', { 'session.id': 'the-session-that-ended' });
    const entry = (
      (sentBodies()[0].resourceLogs as never[])[0] as {
        scopeLogs: { logRecords: { attributes: { key: string; value: { stringValue: string } }[] }[] }[];
      }
    ).scopeLogs[0].logRecords[0];
    const sessionId = entry.attributes.find((a) => a.key === 'session.id');
    expect(sessionId?.value.stringValue).toBe('the-session-that-ended');
  });

  it('still enriches records that say nothing about the session', () => {
    recordEvent('app.jank', {});
    const entry = (
      (sentBodies()[0].resourceLogs as never[])[0] as {
        scopeLogs: { logRecords: { attributes: { key: string }[] }[] }[];
      }
    ).scopeLogs[0].logRecords[0];
    expect(entry.attributes.map((a) => a.key)).toContain('session.id');
  });
});
