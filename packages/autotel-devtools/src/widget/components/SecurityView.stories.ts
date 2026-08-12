import type { Meta, StoryObj } from '@storybook/svelte-vite';
import SecurityView from './SecurityView.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Views/SecurityView',
  component: SecurityView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SecurityView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Reads its data from the widget store rather than props, so with an unseeded
 * store this is the empty state — which is also what a fresh receiver shows.
 */
export const Default: Story = { args: {} };
