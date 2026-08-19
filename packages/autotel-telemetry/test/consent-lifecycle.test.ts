import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '../src/types';

import { runWithTelemetry } from '../src/create';
import type { OutboxLike } from '../src/outbox';

/** An outbox that keeps runs in memory and counts what it was asked to do. */
function createRecordingOutbox() {
  const appended: RunEvent[] = [];
  let purges = 0;
  const outbox: OutboxLike = {
    append: async (event) => {
      appended.push(event);
    },
    readAll: async () => appended,
    purge: async () => {
      purges += 1;
    },
  };
  return {
    outbox,
    appended,
    purgeCount: () => purges,
  };
}

describe('telemetry consent lifecycle', () => {
  afterEach(() => {
    delete process.env.AUTOTEL_TELEMETRY;
    vi.clearAllMocks();
  });

  it('finishes an enabled run while its command context is active', async () => {
    process.env.AUTOTEL_TELEMETRY = '1';
    const { outbox, appended, purgeCount } = createRecordingOutbox();

    await runWithTelemetry(
      { name: 'autotel-test', version: '1', outbox },
      'doctor',
      [],
      async () => 'ok',
    );

    expect(appended).toHaveLength(1);
    expect(purgeCount()).toBe(1);
  });

  it('does not finish a run after consent is withdrawn by the command', async () => {
    process.env.AUTOTEL_TELEMETRY = '1';
    const { outbox, appended, purgeCount } = createRecordingOutbox();

    await runWithTelemetry(
      { name: 'autotel-test', version: '1', outbox },
      'telemetry',
      [],
      async () => {
        process.env.AUTOTEL_TELEMETRY = '0';
      },
    );

    expect(appended).toHaveLength(0);
    expect(purgeCount()).toBe(0);
  });

  it('retains the outbox when delivery fails', async () => {
    process.env.AUTOTEL_TELEMETRY = '1';
    const { outbox, appended, purgeCount } = createRecordingOutbox();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('offline'));

    await runWithTelemetry(
      {
        name: 'autotel-test',
        version: '1',
        endpoint: 'https://telemetry.example.test',
        outbox,
      },
      'doctor',
      [],
      async () => 'ok',
    );

    // The run was queued and, because the drain rejected, never purged.
    expect(appended).toHaveLength(1);
    expect(purgeCount()).toBe(0);
    fetchSpy.mockRestore();
  });
});
