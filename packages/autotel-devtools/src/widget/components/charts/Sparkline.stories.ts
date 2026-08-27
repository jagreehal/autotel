import type { Meta, StoryObj } from '@storybook/svelte-vite';
import Sparkline from './Sparkline.svelte';
import type { MetricPoint } from '../../../server/metric-streams';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const T0 = 1_700_000_000_000;
const series = (values: number[]): MetricPoint[] =>
  values.map((value, i) => ({
    timestamp: T0 + i * 1000,
    attributes: {},
    value,
  }));

const meta = {
  title: 'Charts/Sparkline',
  component: Sparkline,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Sparkline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rising: Story = {
  args: { points: series([1, 3, 2, 5, 8, 7, 12, 15]) },
};

export const Spiky: Story = {
  args: { points: series([2, 2, 3, 2, 40, 3, 2, 2]) },
};

/** A flat series still draws a line rather than collapsing. */
export const Flat: Story = {
  args: { points: series([5, 5, 5, 5, 5]) },
};

/** One point cannot make a line, so it renders a dash instead. */
export const SinglePoint: Story = {
  args: { points: series([5]) },
};

export const Empty: Story = {
  args: { points: [] },
};

export const Wide: Story = {
  args: {
    points: series(
      Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 10 + 12),
    ),
    width: 240,
    height: 40,
  },
};
