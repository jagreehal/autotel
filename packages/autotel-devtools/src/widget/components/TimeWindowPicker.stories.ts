import type { Meta, StoryObj } from '@storybook/svelte-vite';
import TimeWindowPicker from './TimeWindowPicker.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/TimeWindowPicker',
  component: TimeWindowPicker,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TimeWindowPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default: no choice made, so views may fit their own data. */
export const AllTime: Story = {
  args: { selection: { type: 'preset', preset: 'all' }, onChange: () => {} },
};

export const LastFifteenMinutes: Story = {
  args: { selection: { type: 'preset', preset: '15m' }, onChange: () => {} },
};

export const LastTwentyFourHours: Story = {
  args: { selection: { type: 'preset', preset: '24h' }, onChange: () => {} },
};

/** A custom range labels itself with its bounds rather than a preset name. */
export const CustomRange: Story = {
  args: {
    selection: {
      type: 'custom',
      start: Date.parse('2026-08-24T09:00:00'),
      end: Date.parse('2026-08-24T09:30:00'),
    },
    onChange: () => {},
  },
};
