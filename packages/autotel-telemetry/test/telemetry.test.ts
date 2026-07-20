import { describe, expect, it, vi } from 'vitest';
import { sanitizeFlags } from '../src/sanitize';
import { parseIngestBody } from '../src/ingest';
import { resolveConsent } from '../src/consent';
import { composeDrains, createHttpDrain } from '../src/drain';

describe('autotel-telemetry', () => {
  it('sanitizes sensitive flags as presence-only', () => {
    const flags = sanitizeFlags(['--token', 'secret-value', '--verbose']);
    expect(flags.token).toEqual({ present: true });
    expect(flags.verbose).toBe(true);
  });

  it('validates ingest bodies', () => {
    const result = parseIngestBody({
      events: [
        {
          tool: 'autotel',
          version: '1',
          command: 'init',
          outcome: 'success',
          durationMs: 1,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('respects DO_NOT_TRACK', () => {
    const prev = process.env.DO_NOT_TRACK;
    process.env.DO_NOT_TRACK = '1';
    expect(resolveConsent('autotel')).toBe(false);
    process.env.DO_NOT_TRACK = prev;
  });

  it('treats non-success HTTP responses as failed delivery', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }));
    const drain = createHttpDrain('https://telemetry.example.test');

    await expect(
      drain([
        {
          tool: 'autotel',
          version: '1',
          command: 'doctor',
          outcome: 'success',
          durationMs: 1,
        },
      ]),
    ).rejects.toThrow('503');
    fetchSpy.mockRestore();
  });

  it('propagates drain failures so callers retain their outbox', async () => {
    const failed = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(composeDrains(failed)([])).rejects.toThrow('offline');
  });
});
