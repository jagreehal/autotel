import type { Meta, StoryObj } from '@storybook/svelte-vite';
import TabBar from './TabBar.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Chrome/TabBar',
  component: TabBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = { args: { orientation: 'horizontal' } };

/** Vertical, as used by the full-page layout's sidebar. */
export const Vertical: Story = { args: { orientation: 'vertical' } };
