/**
 * The WebSocket has to answer on both loopback families.
 *
 * A loopback bind creates two listeners, because `localhost` resolves to
 * `::1` on macOS and `127.0.0.1` elsewhere and a receiver on one is invisible
 * to a client using the other. HTTP routes were attached to both from the
 * start; the WebSocket was not, so the widget connected on `127.0.0.1` and
 * silently failed on `localhost` — telemetry visible over HTTP, no live tail.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createDevtools } from '../../index';

let close: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (close) await close();
  close = null;
});

/**
 * Through `createDevtools`, deliberately.
 *
 * Wiring this up by hand in the test would prove the mechanism works while
 * leaving the shipped path free to forget it, which is exactly the bug: the
 * capability existed on the server object and the callers never called it.
 */
async function startDualStack(): Promise<number> {
  const devtools = createDevtools({ port: 0, host: 'localhost' });
  close = devtools.close;
  // `ready` rather than the returned `port`, which is the requested one: with
  // `port: 0` that stays 0, and the sibling is not up until this resolves.
  const { port } = await devtools.ready;
  return port;
}

/** Resolves to the negotiated protocol on open, or rejects on error. */
function connect(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`timed out connecting to ${url}`));
    }, 3000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('WebSocket across both loopback families', () => {
  it('accepts a connection on the IPv4 address', async () => {
    const port = await startDualStack();
    await expect(connect(`ws://127.0.0.1:${port}/ws`)).resolves.toBeUndefined();
  });

  it('accepts a connection on the IPv6 address, which is what localhost resolves to on macOS', async () => {
    const port = await startDualStack();
    await expect(connect(`ws://[::1]:${port}/ws`)).resolves.toBeUndefined();
  });

  it('still refuses an upgrade on a path it does not serve', async () => {
    const port = await startDualStack();
    await expect(connect(`ws://127.0.0.1:${port}/nope`)).rejects.toThrow();
  });
});
