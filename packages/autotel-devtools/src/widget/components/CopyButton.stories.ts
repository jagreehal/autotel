import type { Meta, StoryObj } from '@storybook/svelte-vite';
import CopyButton from './CopyButton.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/CopyButton',
  component: CopyButton,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { value: 'trace-abc123' } };

export const WithLabel: Story = {
  args: { value: 'trace-abc123', label: 'Copy trace ID' },
};

/** Larger hit area, used in headers rather than inline. */
export const Large: Story = { args: { value: 'trace-abc123', size: 20 } };
