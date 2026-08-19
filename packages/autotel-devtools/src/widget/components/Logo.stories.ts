import type { Meta, StoryObj } from '@storybook/svelte-vite';
import Logo from './Logo.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/Logo',
  component: Logo,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };

export const Large: Story = { args: { width: 96, height: 96 } };

/** Inherits a caller-supplied colour. */
export const Tinted: Story = {
  args: { fill: '#38bdf8', width: 64, height: 64 },
};
