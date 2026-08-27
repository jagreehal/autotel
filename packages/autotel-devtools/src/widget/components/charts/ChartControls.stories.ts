import type { Meta, StoryObj } from '@storybook/svelte-vite';
import ChartControls from './ChartControls.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Charts/ChartControls',
  component: ChartControls,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ChartControls>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};
const base = {
  mode: 'timeseries' as const,
  onMode: noop,
  aggregate: 'sum' as const,
  onAggregate: noop,
  stacked: false,
  onStacked: noop,
  rate: false,
  onRate: noop,
};

/** A counter: rate and stacking both apply, no distribution modes. */
export const Counter: Story = {
  args: { ...base, kind: 'sum' },
};

/** A gauge is a level, so neither rate nor stacking is offered. */
export const Gauge: Story = {
  args: { ...base, kind: 'gauge' },
};

/** A histogram adds the distribution modes. */
export const Histogram: Story = {
  args: { ...base, kind: 'histogram' },
};

/** In a distribution mode the time-series-only controls step aside. */
export const HeatmapMode: Story = {
  args: { ...base, kind: 'histogram', mode: 'heatmap' },
};

export const PercentilesMode: Story = {
  args: { ...base, kind: 'histogram', mode: 'percentiles' },
};

/** Everything on. */
export const StackedRate: Story = {
  args: { ...base, kind: 'sum', stacked: true, rate: true, aggregate: 'avg' },
};
