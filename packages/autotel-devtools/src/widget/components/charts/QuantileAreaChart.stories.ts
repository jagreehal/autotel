import type { Meta, StoryObj } from '@storybook/svelte-vite';
import QuantileAreaChart from './QuantileAreaChart.svelte';
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
  title: 'Charts/QuantileAreaChart',
  component: QuantileAreaChart,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof QuantileAreaChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Steady latency: the bands stay parallel. */
export const Steady: Story = {
  args: {
    unit: 'ms',
    points: Array.from({ length: 16 }, (_, i) =>
      column(i, [70, 25, 8, 3, 1, 0]),
    ),
  },
};

/**
 * The tail pulling away from the median — the band widens while p50 barely
 * moves. This is what three overlapping lines make you infer.
 */
export const TailDiverging: Story = {
  args: {
    unit: 'ms',
    points: Array.from({ length: 16 }, (_, i) =>
      column(i, [70, 25, 8, 3 + i, Math.floor(i / 2), Math.floor(i / 4)]),
    ),
  },
};

/** A regression that moves the whole distribution, not just the tail. */
export const WholeDistributionShifts: Story = {
  args: {
    unit: 'ms',
    points: Array.from({ length: 16 }, (_, i) =>
      i < 8
        ? column(i, [90, 20, 5, 1, 0, 0])
        : column(i, [5, 15, 40, 30, 10, 2]),
    ),
  },
};

/** A custom quantile set. */
export const MedianAndP999: Story = {
  args: {
    unit: 'ms',
    quantiles: [0.5, 0.999],
    points: Array.from({ length: 12 }, (_, i) =>
      column(i, [70, 25, 8, 3, 1, 1]),
    ),
  },
};

export const Empty: Story = {
  args: { points: [] },
};
