import type { Meta, StoryObj } from '@storybook/svelte-vite';
import Layout from './Layout.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Chrome/Layout',
  component: Layout,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Layout>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Reads its data from the widget store rather than props, so with an unseeded
 * store this is the empty state — which is also what a fresh receiver shows.
 */
export const Default: Story = { args: {} };
