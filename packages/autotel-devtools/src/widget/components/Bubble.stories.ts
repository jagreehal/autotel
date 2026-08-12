import type { Meta, StoryObj } from '@storybook/svelte-vite';
import Bubble from './Bubble.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/Bubble',
  component: Bubble,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Bubble>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };
