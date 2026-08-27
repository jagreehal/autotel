/**
 * @vitest-environment jsdom
 *
 * Compare view behaviour.
 *
 * What matters here is that the four outcomes stay visibly different. A
 * comparison that renders "nothing found" for a broken query, an empty
 * population and a genuine null result is worse than no comparison, because
 * all three read as "these groups are alike".
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/svelte';
import CompareView from '../components/CompareView.svelte';
import { connectionUrlSignal } from '../store.svelte';

const realFetch = globalThis.fetch;

beforeEach(() => {
  connectionUrlSignal.value = 'ws://127.0.0.1:4318/ws';
});

function stubFetch(status: number, body: unknown) {
  const fetchFn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  globalThis.fetch = fetchFn as unknown as typeof fetch;
  return fetchFn;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  connectionUrlSignal.value = null;
});

describe('CompareView', () => {
  it('explains when no receiver URL is configured without issuing a request', async () => {
    const fetchFn = vi.fn();
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    connectionUrlSignal.value = null;

    render(CompareView);
    await fireEvent.click(screen.getByRole('button', { name: /compare/i }));

    expect(screen.getByText(/receiver is not connected/i)).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('ranks the attributes that separate the two groups', async () => {
    stubFetch(200, {
      differences: [
        {
          field: 'payment.provider',
          value: 'legacy',
          outlierFraction: 1,
          baselineFraction: 0.03,
          difference: 0.97,
          outlierCount: 20,
          baselineCount: 1,
        },
      ],
      outlierCount: 20,
      baselineCount: 30,
    });

    render(CompareView);
    await fireEvent.click(screen.getByRole('button', { name: /compare/i }));

    await waitFor(() =>
      expect(screen.getByText(/payment\.provider/)).toBeTruthy(),
    );
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('3%')).toBeTruthy();
  });

  it('says a side was empty rather than reporting no difference', async () => {
    stubFetch(200, { differences: [], outlierCount: 0, baselineCount: 30 });

    render(CompareView);
    await fireEvent.click(screen.getByRole('button', { name: /compare/i }));

    await waitFor(() =>
      expect(screen.getByText(/Nothing to compare/)).toBeTruthy(),
    );
  });

  it('explains a server that has no autotel to borrow the ranking from', async () => {
    stubFetch(501, {
      error: 'Comparison unavailable',
      message:
        'Install `autotel` alongside autotel-devtools to compare cohorts.',
    });

    render(CompareView);
    await fireEvent.click(screen.getByRole('button', { name: /compare/i }));

    await waitFor(() => expect(screen.getByText(/Install/)).toBeTruthy());
  });

  it('swaps the query input for the marker when a moment is marked', async () => {
    stubFetch(200, { differences: [], outlierCount: 1, baselineCount: 1 });
    render(CompareView);

    expect(screen.getByLabelText(/Investigating/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Mark now/i }));

    expect(screen.queryByLabelText(/Investigating/)).toBeNull();
    expect(screen.getByText(/since the mark/)).toBeTruthy();
  });
});
