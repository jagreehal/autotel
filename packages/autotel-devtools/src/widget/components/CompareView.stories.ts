import type { Meta, StoryObj } from '@storybook/svelte-vite';
import CompareView from './CompareView.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `__tests__/CompareView.test.ts`.
//
// Each story stubs `fetch` through `beforeEach`, which takes a teardown: a
// decorator that replaces a global and walks away leaks into every later story.

const meta = {
  title: 'Views/Compare',
  component: CompareView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CompareView>;

export default meta;
type Story = StoryObj<typeof meta>;

function respondWith(status: number, body: unknown) {
  return () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    return () => {
      globalThis.fetch = real;
    };
  };
}

/** Before anything has been run. */
export const Initial: Story = {};

/** The payoff: one attribute accounts for the whole difference. */
export const RankedDifferences: Story = {
  beforeEach: respondWith(200, {
    outlierCount: 20,
    baselineCount: 340,
    differences: [
      {
        field: 'payment.provider',
        value: 'legacy',
        outlierFraction: 1,
        baselineFraction: 0.03,
        difference: 0.97,
        outlierCount: 20,
        baselineCount: 10,
      },
      {
        field: 'db.pool.saturated',
        value: 'true',
        outlierFraction: 0.85,
        baselineFraction: 0.11,
        difference: 0.74,
        outlierCount: 17,
        baselineCount: 37,
      },
    ],
  }),
};

/** Nothing matched one side, which is not the same as finding no difference. */
export const EmptyPopulation: Story = {
  beforeEach: respondWith(200, {
    differences: [],
    outlierCount: 0,
    baselineCount: 340,
  }),
};

/** Both groups match, and nothing tells them apart. */
export const NoDifference: Story = {
  beforeEach: respondWith(200, {
    differences: [],
    outlierCount: 20,
    baselineCount: 340,
  }),
};

/** The viewer is running without `autotel`, so there is no ranking to borrow. */
export const Unavailable: Story = {
  beforeEach: respondWith(501, {
    error: 'Comparison unavailable',
    message: 'Install `autotel` alongside autotel-devtools to compare cohorts.',
  }),
};

/** A query the server could not parse. */
export const InvalidQuery: Story = {
  beforeEach: respondWith(400, {
    error: 'Invalid comparison request',
    message: 'Cohort query did not parse: unexpected ">" at column 12',
  }),
};
