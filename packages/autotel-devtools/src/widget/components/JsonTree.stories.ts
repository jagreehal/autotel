import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';
import JsonTree from './JsonTree.svelte';

const meta = {
  title: 'Views/JsonTree',
  component: JsonTree,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof JsonTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GenAiMessages: Story = {
  args: {
    data: [
      {
        role: 'assistant',
        parts: [{ type: 'text', content: 'Believe in yourself.' }],
        finish_reason: 'stop',
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('role:')).toBeInTheDocument();
    await expect(canvas.getByText('"assistant"')).toBeInTheDocument();
  },
};

export const NestedCollapses: Story = {
  args: {
    // root(open) > lvl1(open) > lvl2 array at depth 2 starts collapsed.
    data: { lvl1: { lvl2: [1, 2, 3] } },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('3 items')).toBeInTheDocument();
  },
};

export const TogglesOpen: Story = {
  args: { data: { a: { b: 1 } } },
  play: async ({ canvas, canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole('button');
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[0]);
    await expect(canvas.getByText('a:')).toBeInTheDocument();
  },
};
