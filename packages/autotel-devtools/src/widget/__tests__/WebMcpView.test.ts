/**
 * @vitest-environment jsdom
 *
 * WebMCP view behaviour.
 *
 * The load-bearing claims: a withdrawn tool is visibly not on offer, a tool
 * the instrumentation never saw registered makes no claim about annotations,
 * captured payloads are masked until asked for, and an empty window explains
 * how to get data rather than saying "empty" — which is the state nearly every
 * reader lands in, since WebMCP is behind a flag.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import WebMcpView from '../components/WebMcpView.svelte';
import { connectionUrlSignal, timeWindowSignal } from '../store.svelte';
import { DEFAULT_SELECTION } from '../timeWindow';
import { makeInventory, makeTool } from '../components/__fixtures__/webmcp';
import type { WebMcpInventory } from '../types';

const realFetch = globalThis.fetch;

beforeEach(() => {
  connectionUrlSignal.value = 'ws://127.0.0.1:4318/ws';
  timeWindowSignal.value = DEFAULT_SELECTION;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  connectionUrlSignal.value = null;
  timeWindowSignal.value = DEFAULT_SELECTION;
});

function stubInventory(webmcp: WebMcpInventory) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ webmcp }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('WebMcpView', () => {
  it('explains when no receiver is connected without issuing a request', async () => {
    const fetchFn = vi.fn();
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    connectionUrlSignal.value = null;

    render(WebMcpView);

    await waitFor(() =>
      expect(screen.getByText(/receiver is not connected/i)).toBeTruthy(),
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('separates a tool still on offer from one that has been withdrawn', async () => {
    stubInventory(
      makeInventory([
        makeTool({ name: 'view_cart', offered: true }),
        makeTool({ name: 'checkout', offered: false }),
      ]),
    );

    render(WebMcpView);

    await waitFor(() => expect(screen.getByText('view_cart')).toBeTruthy());
    expect(screen.getByText('offered')).toBeTruthy();
    expect(screen.getByText('withdrawn')).toBeTruthy();
  });

  it('names the annotations the browser dropped, which nothing else records', async () => {
    stubInventory(
      makeInventory([
        makeTool({
          annotationsSent: ['readOnlyHint', 'destructiveHint'],
          annotationsDropped: ['destructiveHint'],
        }),
      ]),
    );

    render(WebMcpView);

    await waitFor(() =>
      expect(screen.getByText(/dropped destructiveHint/)).toBeTruthy(),
    );
  });

  it('says so when a tool was never seen registered, rather than implying it is clean', async () => {
    stubInventory(
      makeInventory([
        makeTool({ observedAtRegistration: false, offered: false }),
      ]),
    );

    render(WebMcpView);

    await waitFor(() =>
      expect(screen.getByText(/not observed at registration/i)).toBeTruthy(),
    );
  });

  it('warns about an installation that registered nothing', async () => {
    stubInventory(
      makeInventory([makeTool()], { installations: 2, emptyInstallations: 1 }),
    );

    render(WebMcpView);

    await waitFor(() =>
      expect(
        screen.getByText(/call it before registering your tools/i),
      ).toBeTruthy(),
    );
  });

  it('masks a captured result until it is revealed', async () => {
    const secret = 'ISRC GBAYE0601498 — 4,182 streams';
    stubInventory(
      makeInventory([
        makeTool({
          recentCalls: [
            {
              timestamp: 1_700_000_000_400,
              durationMs: 4,
              resultBytes: 33,
              resultType: 'string',
              envelope: false,
              substituted: false,
              error: false,
              result: secret,
              traceId: 't1',
              spanId: 's1',
            },
          ],
        }),
      ]),
    );

    render(WebMcpView);

    await waitFor(() => expect(screen.getByText('checkout')).toBeTruthy());
    await fireEvent.click(screen.getByText('checkout'));

    expect(screen.queryByText(secret)).toBeNull();

    await fireEvent.click(screen.getByText(/reveal payloads/i));
    expect(screen.getByText(secret)).toBeTruthy();
  });

  it('gives an empty window the install instructions rather than the word empty', async () => {
    stubInventory(makeInventory([]));

    render(WebMcpView);

    await waitFor(() =>
      expect(
        screen.getByText(/web-machine-learning-model-context/),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/before you register any tools/i)).toBeTruthy();
  });

  it('does not replace a newer window with an older response', async () => {
    const requests: Array<(response: Response) => void> = [];
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          requests.push(resolve);
        }),
    ) as unknown as typeof fetch;

    render(WebMcpView);
    await waitFor(() => expect(requests).toHaveLength(1));

    timeWindowSignal.value = { type: 'custom', start: 200, end: 300 };
    await waitFor(() => expect(requests).toHaveLength(2));

    requests[1]!(
      new Response(
        JSON.stringify({ webmcp: makeInventory([makeTool({ name: 'new' })]) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await waitFor(() => expect(screen.getByText('new')).toBeTruthy());

    requests[0]!(
      new Response(
        JSON.stringify({ webmcp: makeInventory([makeTool({ name: 'old' })]) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('old')).toBeNull();
    expect(screen.getByText('new')).toBeTruthy();
  });
});
