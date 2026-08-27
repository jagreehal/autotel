import type { Meta, StoryObj } from '@storybook/svelte-vite';
import HistogramChart from './HistogramChart.svelte';
import { histogramSeries } from './__fixtures__/metrics';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Charts/HistogramChart',
  component: HistogramChart,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof HistogramChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LatencyDistribution: Story = {
  args: { point: histogramSeries[0].points[0], unit: 'ms' },
};

/** All observations in one bucket — the shape is flat but still true. */
export const SingleBucket: Story = {
  args: {
    point: {
      timestamp: Date.now(),
      attributes: {},
      count: 12,
      bucketCounts: [12],
      explicitBounds: [],
    },
  },
};

/** A heavy tail: most requests fast, a few very slow. */
export const HeavyTail: Story = {
  args: {
    point: {
      timestamp: Date.now(),
      attributes: {},
      count: 1000,
      bucketCounts: [900, 60, 30, 10],
      explicitBounds: [10, 100, 1000],
    },
    unit: 'ms',
  },
};

/** A point with no buckets says so rather than drawing an empty axis. */
export const NoBuckets: Story = {
  args: { point: { timestamp: Date.now(), attributes: {}, value: 3 } },
};
