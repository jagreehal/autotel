/**
 * @vitest-environment jsdom
 *
 * Coverage view behaviour.
 *
 * The load-bearing claims: unseen entry points come first, because finding
 * them is the only reason to open this tab, and a missing map says so rather
 * than rendering an empty table that would read as full coverage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import CoverageView from '../components/CoverageView.svelte';
import { connectionUrlSignal } from '../store.svelte';

const realFetch = globalThis.fetch;

beforeEach(() => {
  connectionUrlSignal.value = 'ws://127.0.0.1:4318/ws';
});

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  connectionUrlSignal.value = null;
});

describe('CoverageView', () => {
  it('explains when no receiver URL is configured without issuing a request', async () => {
    const fetchFn = vi.fn();
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    connectionUrlSignal.value = null;

    render(CoverageView);

    await waitFor(() =>
      expect(screen.getByText(/receiver is not connected/i)).toBeTruthy(),
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('leads with how many entry points are dark', async () => {
    stubFetch(200, {
      total: 2,
      seenCount: 1,
      entries: [
        {
          method: 'POST',
          path: '/orders',
          file: 'src/orders.ts',
          seen: false,
          spanCount: 0,
        },
        {
          method: 'GET',
          path: '/users',
          file: 'src/users.ts',
          seen: true,
          spanCount: 12,
        },
      ],
    });

    render(CoverageView);

    await waitFor(() =>
      expect(screen.getByText(/1 of 2 entry points have emitted/)).toBeTruthy(),
    );
    expect(screen.getByText('none')).toBeTruthy();
  });

  it('puts the unseen entry point above the one that works', async () => {
    stubFetch(200, {
      total: 2,
      seenCount: 1,
      entries: [
        {
          method: 'POST',
          path: '/orders',
          file: 'src/orders.ts',
          seen: false,
          spanCount: 0,
        },
        {
          method: 'GET',
          path: '/users',
          file: 'src/users.ts',
          seen: true,
          spanCount: 12,
        },
      ],
    });

    render(CoverageView);

    await waitFor(() => expect(screen.getByText(/POST \/orders/)).toBeTruthy());
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('/orders');
  });

  it('tells you to run the map instead of showing an empty table', async () => {
    stubFetch(404, {
      error: 'No instrumentation map',
      message:
        "Run `npx autotel map` to record this project's entry points, then reload.",
    });

    render(CoverageView);

    await waitFor(() =>
      expect(screen.getByText(/npx autotel map/)).toBeTruthy(),
    );
  });

  it('links each entry point at its source file', async () => {
    stubFetch(200, {
      total: 1,
      seenCount: 0,
      entries: [
        {
          method: 'POST',
          path: '/orders',
          file: 'src/orders.ts',
          handler: { line: 42 },
          seen: false,
          spanCount: 0,
        },
      ],
    });

    render(CoverageView);

    await waitFor(() => expect(screen.getByRole('link')).toBeTruthy());
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      'vscode://file/src/orders.ts:42',
    );
  });
});
