import type { Meta, StoryObj } from '@storybook/svelte-vite';
import ResizablePanel from './ResizablePanel.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Chrome/ResizablePanel',
  component: ResizablePanel,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ResizablePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = { args: { dragging: false } };

/** Mid-drag, when the handle is emphasised. */
export const Dragging: Story = { args: { dragging: true } };

export const Titled: Story = {
  args: { dragging: false, title: 'Drag to resize the span detail panel' },
};
