import type { Meta, StoryObj } from '@storybook/svelte-vite';
import HistogramHeatmap from './HistogramHeatmap.svelte';
import type { MetricPoint } from '../../../server/metric-streams';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const T0 = 1_700_000_000_000;
const BOUNDS = [10, 50, 100, 500, 1000];

function column(offset: number, counts: number[]): MetricPoint {
  return {
    timestamp: T0 + offset * 30_000,
    attributes: {},
    count: counts.reduce((sum, n) => sum + n, 0),
    bucketCounts: counts,
    explicitBounds: BOUNDS,
  };
}

const meta = {
  title: 'Charts/HistogramHeatmap',
  component: HistogramHeatmap,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof HistogramHeatmap>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Most requests fast, a thin tail — the common healthy shape. */
export const HealthyTail: Story = {
  args: {
    unit: 'ms',
    points: Array.from({ length: 14 }, (_, i) =>
      column(i, [80, 30, 10, 4, 1, 0]),
    ),
  },
};

/**
 * Two bands rather than one distribution with a tail — a cache hit and a cache
 * miss. This is the shape a p99 line cannot show you.
 */
export const Bimodal: Story = {
  args: {
    unit: 'ms',
    points: Array.from({ length: 14 }, (_, i) =>
      column(i, [60, 5, 2, 40, 3, 0]),
    ),
  },
};

/** A latency regression appearing partway through the window. */
export const Regression: Story = {
  args: {
    unit: 'ms',
    points: Array.from({ length: 14 }, (_, i) =>
      i < 7
        ? column(i, [90, 20, 5, 1, 0, 0])
        : column(i, [10, 15, 30, 40, 20, 5]),
    ),
  },
};

/** One spike: the floor on cell opacity keeps the quiet cells visible. */
export const SingleSpike: Story = {
  args: {
    unit: 'ms',
    points: Array.from({ length: 10 }, (_, i) =>
      i === 5
        ? column(i, [2, 1, 9000, 1, 0, 0])
        : column(i, [2, 1, 1, 0, 0, 0]),
    ),
  },
};

/** Nothing bucketed in the window. */
export const Empty: Story = {
  args: { points: [] },
};
