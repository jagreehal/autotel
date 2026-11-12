import { describe, expect, it, vi } from 'vitest';
import * as Context from 'effect/Context';

// Its own file: mocks autotel's flush to fail, which request.test.ts needs real.
vi.mock('autotel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('autotel')>()),
  flush: vi.fn(() => Promise.reject(new Error('flush timed out'))),
}));

const { webHandler, WaitUntil } = await import('./serverless.js');

describe('webHandler when flush fails', () => {
  it('still returns the response', async () => {
    const handler = webHandler(async () => new Response('ok'), {
      waitUntil: () => undefined,
    });
    const response = await handler(new Request('http://localhost/'));
    expect(await response.text()).toBe('ok');
  });

  it("keeps the handler's own error", async () => {
    const handler = webHandler(
      async () => {
        throw new Error('handler failed');
      },
      { waitUntil: () => undefined },
    );
    await expect(handler(new Request('http://localhost/'))).rejects.toThrow(
      'handler failed',
    );
  });

  it('hands the platform work that settles as the work did, not as the flush', async () => {
    const kept: Promise<unknown>[] = [];
    const handler = webHandler(async () => new Response('ok'), {
      waitUntil: () => (work) => void kept.push(work),
    });
    await handler(new Request('http://localhost/'));
    await expect(Promise.all(kept)).resolves.toBeDefined();
  });

  it('observes rejected work as soon as it is registered', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const handler = webHandler(
      async (_request, context) => {
        const waitUntil = Context.get(context!, WaitUntil);
        waitUntil(Promise.reject(new Error('background failed')));
        // The handler still awaiting I/O when the rejection lands.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response('ok');
      },
      { waitUntil: () => undefined },
    );
    const response = await handler(new Request('http://localhost/'));
    process.off('unhandledRejection', unhandled);
    expect(await response.text()).toBe('ok');
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('awaits work that registered work registers', async () => {
    let done = false;
    const handler = webHandler(
      async (_request, context) => {
        const waitUntil = Context.get(context!, WaitUntil);
        waitUntil(
          new Promise((resolve) => setTimeout(resolve, 10)).then(() =>
            waitUntil(
              new Promise((resolve) => setTimeout(resolve, 20)).then(() => {
                done = true;
              }),
            ),
          ),
        );
        return new Response('ok');
      },
      { waitUntil: () => undefined },
    );
    await handler(new Request('http://localhost/'));
    expect(done).toBe(true);
  });
});
