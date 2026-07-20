import { afterEach, describe, expect, it, vi } from 'vitest';

const { append, readAll, purge } = vi.hoisted(() => ({
  append: vi.fn(async () => {}),
  readAll: vi.fn(async () => []),
  purge: vi.fn(async () => {}),
}));

vi.mock('../src/outbox', () => ({
  TelemetryOutbox: class {
    append = append;
    readAll = readAll;
    purge = purge;
  },
}));

import { runWithTelemetry } from '../src/create';

describe('telemetry consent lifecycle', () => {
  afterEach(() => {
    delete process.env.AUTOTEL_TELEMETRY;
    vi.clearAllMocks();
  });

  it('finishes an enabled run while its command context is active', async () => {
    process.env.AUTOTEL_TELEMETRY = '1';

    await runWithTelemetry(
      { name: 'autotel-test', version: '1' },
      'doctor',
      [],
      async () => 'ok',
    );

    expect(append).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it('does not finish a run after consent is withdrawn by the command', async () => {
    process.env.AUTOTEL_TELEMETRY = '1';

    await runWithTelemetry(
      { name: 'autotel-test', version: '1' },
      'telemetry',
      [],
      async () => {
        process.env.AUTOTEL_TELEMETRY = '0';
      },
    );

    expect(append).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
  });

  it('retains the outbox when delivery fails', async () => {
    process.env.AUTOTEL_TELEMETRY = '1';
    readAll.mockResolvedValueOnce([
      {
        tool: 'autotel-test',
        version: '1',
        command: 'doctor',
        outcome: 'success',
        durationMs: 1,
      },
    ]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('offline'));

    await runWithTelemetry(
      {
        name: 'autotel-test',
        version: '1',
        endpoint: 'https://telemetry.example.test',
      },
      'doctor',
      [],
      async () => 'ok',
    );

    expect(append).toHaveBeenCalledTimes(1);
    expect(purge).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
