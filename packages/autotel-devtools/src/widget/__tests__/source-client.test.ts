import { describe, it, expect, vi } from 'vitest';
import {
  httpBaseFromWsUrl,
  createSourceLoader,
  configureSourceLoader,
  loadSourceWindow,
} from '../source-client';
import type { StackFrame } from '../../server/parse-stack';

const FRAME: StackFrame = {
  function: 'quote',
  file: '/proj/src/carrier.ts',
  line: 42,
  column: 11,
  kind: 'app',
};

describe('httpBaseFromWsUrl', () => {
  // The widget may be embedded in a page on a different origin from the
  // receiver, so `location` is the wrong source of truth — the live WebSocket
  // URL is the only thing that names the receiver.
  it('converts a ws URL to the http origin it came from', () => {
    expect(httpBaseFromWsUrl('ws://127.0.0.1:4318/ws')).toBe(
      'http://127.0.0.1:4318',
    );
  });

  it('keeps TLS when the socket was secure', () => {
    expect(httpBaseFromWsUrl('wss://devtools.internal/ws')).toBe(
      'https://devtools.internal',
    );
  });

  it('returns null for something that is not a ws URL', () => {
    expect(httpBaseFromWsUrl('not a url')).toBeNull();
  });
});

describe('createSourceLoader', () => {
  it('asks the receiver for the frame position and context', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        file: 'src/carrier.ts',
        line: 42,
        startLine: 40,
        lines: ['a', 'b', 'c'],
      }),
    });

    const load = createSourceLoader('http://127.0.0.1:4318', fetchImpl);
    const result = await load(FRAME, 2);

    const requested = new URL(fetchImpl.mock.calls[0][0]);
    expect(requested.pathname).toBe('/source');
    expect(requested.searchParams.get('file')).toBe('/proj/src/carrier.ts');
    expect(requested.searchParams.get('line')).toBe('42');
    expect(requested.searchParams.get('context')).toBe('2');
    expect(result?.startLine).toBe(40);
  });

  it('resolves to null when the receiver refuses, rather than throwing', async () => {
    const load = createSourceLoader(
      'http://127.0.0.1:4318',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );

    await expect(load(FRAME, 5)).resolves.toBeNull();
  });

  it('resolves to null when the receiver is unreachable', async () => {
    const load = createSourceLoader(
      'http://127.0.0.1:4318',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    await expect(load(FRAME, 5)).resolves.toBeNull();
  });

  it('never asks for a frame with no file on disk', async () => {
    const fetchImpl = vi.fn();
    const load = createSourceLoader('http://127.0.0.1:4318', fetchImpl);

    await expect(
      load({ ...FRAME, kind: 'native', file: 'node:events' }, 5),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('the shared loader', () => {
  it('resolves null before it has been configured, instead of throwing', async () => {
    configureSourceLoader(null);
    await expect(loadSourceWindow(FRAME, 5)).resolves.toBeNull();
  });
});
