import type { Meta, StoryObj } from '@storybook/svelte-vite';
import TimeSeriesChart from './TimeSeriesChart.svelte';
import {
  series,
  twoSeries,
  cumulativeWithReset,
  withExemplars,
} from './__fixtures__/metrics';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Charts/TimeSeriesChart',
  component: TimeSeriesChart,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TimeSeriesChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleSeries: Story = {
  args: { series: [series()] },
};

export const Filled: Story = {
  args: { series: [series()], area: true },
};

export const MultipleSeries: Story = {
  args: { series: twoSeries },
};

/** A cumulative counter is differenced before drawing, reset included. */
export const CumulativeCounter: Story = {
  args: { series: cumulativeWithReset },
};

/** Exemplar dots sit above the line and open the trace that produced them. */
export const WithExemplars: Story = {
  args: { series: withExemplars, onExemplar: () => {} },
};

/** Isolating one series dims the rest without removing them from the legend. */
export const Isolated: Story = {
  args: { series: twoSeries, isolated: new Set(['s-get']) },
};

export const Empty: Story = {
  args: { series: [] },
};

/** A single point is still a measurement, so it is marked rather than dropped. */
export const SinglePoint: Story = {
  args: {
    series: [
      series({ points: [{ timestamp: Date.now(), attributes: {}, value: 7 }] }),
    ],
  },
};
