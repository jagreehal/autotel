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
import { connectionUrlSignal, timeWindowSignal } from '../store.svelte';
import { parse } from '../../query';

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
  timeWindowSignal.value = { type: 'preset', preset: 'all' };
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

  it('sends the chosen time window with both sides of a query comparison', async () => {
    timeWindowSignal.value = { type: 'custom', start: 1000, end: 5000 };
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as {
          outlier: { window?: unknown };
          baseline: { window?: unknown };
        };
        return new Response(
          JSON.stringify({
            differences: [],
            outlierCount: 1,
            baselineCount: 1,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    let body: {
      outlier: { window?: unknown };
      baseline: { window?: unknown };
    } | null = null;
    globalThis.fetch = fetchFn as unknown as typeof fetch;

    render(CompareView);
    await fireEvent.click(screen.getByRole('button', { name: /compare/i }));

    // The toolbar says one thing and the comparison must not answer for
    // another: a window the reader can see is a window both cohorts obey.
    await waitFor(() => {
      expect(body?.outlier.window).toEqual({ start: 1000, end: 5000 });
      expect(body?.baseline.window).toEqual({ start: 1000, end: 5000 });
    });
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

describe('CompareView — experiment cohorts', () => {
  /** One round trip: every experiment with its own arms, commonest first. */
  function stubPairs(
    pairs: Array<{ value: string; paired: string; count: number }>,
  ) {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ pairs }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchFn as unknown as typeof fetch;
    return fetchFn;
  }

  it('offers the arms of a recorded experiment instead of asking you to type them', async () => {
    stubPairs([
      { value: 'checkout-pricing', paired: 'v2', count: 2 },
      { value: 'checkout-pricing', paired: 'v1', count: 1 },
    ]);

    render(CompareView);

    const picker = await screen.findByLabelText('Experiment');
    await fireEvent.change(picker, { target: { value: 'checkout-pricing' } });

    await waitFor(() => {
      const outlier = screen.getByLabelText(
        /Investigating/,
      ) as HTMLInputElement;
      const baseline = screen.getByLabelText(
        /Compared with/,
      ) as HTMLInputElement;
      expect(outlier.value).toBe(
        'experiment.name = "checkout-pricing" AND experiment.variant = "v2"',
      );
      expect(baseline.value).toBe(
        'experiment.name = "checkout-pricing" AND experiment.variant = "v1"',
      );
    });
  });

  it('never offers an arm belonging to another experiment', async () => {
    stubPairs([
      { value: 'checkout-pricing', paired: 'v1', count: 1 },
      { value: 'search-ranking', paired: 'reranked', count: 5 },
      { value: 'search-ranking', paired: 'control', count: 4 },
    ]);

    render(CompareView);

    const picker = await screen.findByLabelText('Experiment');
    await fireEvent.change(picker, { target: { value: 'checkout-pricing' } });

    // `checkout-pricing` ran one arm. Filling the baseline from the commonest
    // variant in the store would name `reranked`, a cohort that cannot match.
    const arm = (await screen.findByLabelText('Arm')) as HTMLSelectElement;
    const against = screen.getByLabelText('Against') as HTMLSelectElement;
    expect([...arm.options].map((o) => o.value)).toEqual(['v1']);
    // The arm being investigated is not offered as its own baseline.
    expect([...against.options].map((o) => o.value)).toEqual(['']);

    const baseline = screen.getByLabelText(/Compared with/) as HTMLInputElement;
    expect(baseline.value).toBe(
      'experiment.name = "checkout-pricing" AND experiment.variant != "v1"',
    );
  });

  it('excludes the investigated arm from the baseline it compares against', async () => {
    stubPairs([
      { value: 'ranking', paired: 'a', count: 9 },
      { value: 'ranking', paired: 'b', count: 5 },
      { value: 'ranking', paired: 'c', count: 2 },
    ]);

    render(CompareView);
    await fireEvent.change(await screen.findByLabelText('Experiment'), {
      target: { value: 'ranking' },
    });

    // Comparing an arm against a group that contains it dilutes the contrast,
    // so the arm under investigation is never on both sides.
    const against = screen.getByLabelText('Against') as HTMLSelectElement;
    expect([...against.options].map((o) => o.value)).toEqual(['', 'b', 'c']);

    await fireEvent.change(screen.getByLabelText('Arm'), {
      target: { value: 'b' },
    });
    await waitFor(() => {
      const baseline = screen.getByLabelText(
        /Compared with/,
      ) as HTMLInputElement;
      // Taking the arm the baseline held resets that side rather than
      // comparing a cohort with itself.
      expect(baseline.value).toBe(
        'experiment.name = "ranking" AND experiment.variant != "b"',
      );
      expect(
        [
          ...(screen.getByLabelText('Against') as HTMLSelectElement).options,
        ].map((o) => o.value),
      ).toEqual(['', 'a', 'c']);
    });
  });

  it('ignores the arm attributes, which define the cohorts and would rank first', async () => {
    let compareBody: Record<string, unknown> | null = null;
    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/query/attributes')) {
          return new Response(
            JSON.stringify({
              pairs: [
                { value: 'ranking', paired: 'a', count: 2 },
                { value: 'ranking', paired: 'b', count: 1 },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        compareBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            differences: [],
            outlierCount: 1,
            baselineCount: 1,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    globalThis.fetch = fetchFn as unknown as typeof fetch;

    render(CompareView);
    await fireEvent.change(await screen.findByLabelText('Experiment'), {
      target: { value: 'ranking' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /compare/i }));

    await waitFor(() => {
      expect(compareBody).not.toBeNull();
      expect(compareBody?.ignoreFields).toEqual([
        'experiment.name',
        'experiment.variant',
      ]);
    });
  });

  it('lets you choose which arms to compare, not just the two commonest', async () => {
    stubPairs([
      { value: 'ranking', paired: 'a', count: 9 },
      { value: 'ranking', paired: 'b', count: 5 },
      { value: 'ranking', paired: 'c', count: 2 },
    ]);

    render(CompareView);

    await fireEvent.change(await screen.findByLabelText('Experiment'), {
      target: { value: 'ranking' },
    });
    await fireEvent.change(await screen.findByLabelText('Against'), {
      target: { value: 'c' },
    });

    await waitFor(() => {
      const baseline = screen.getByLabelText(
        /Compared with/,
      ) as HTMLInputElement;
      expect(baseline.value).toBe(
        'experiment.name = "ranking" AND experiment.variant = "c"',
      );
    });
  });

  it('escapes a quote in a name so the generated query still parses', async () => {
    stubPairs([
      { value: 'pricing "vip"', paired: 'back\\slash', count: 2 },
      { value: 'pricing "vip"', paired: 'plain', count: 1 },
    ]);

    render(CompareView);

    await fireEvent.change(await screen.findByLabelText('Experiment'), {
      target: { value: 'pricing "vip"' },
    });

    await waitFor(() => {
      const outlier = screen.getByLabelText(
        /Investigating/,
      ) as HTMLInputElement;
      expect(outlier.value).toBe(
        'experiment.name = "pricing \\"vip\\"" AND experiment.variant = "back\\\\slash"',
      );
      // Against the real grammar, not a copy of it: the generated query has to
      // parse, and the values have to survive the round trip as themselves.
      expect(parse(outlier.value).ok).toBe(true);
    });
  });
});
