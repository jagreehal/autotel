import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
import Copyable from './Copyable.svelte';

// Catalogue only — no assertions.
//
// `children` is a Svelte snippet, so stories build one with `createRawSnippet`
// rather than a wrapper component.

const text = (html: string) => createRawSnippet(() => ({ render: () => html }));

const meta = {
  title: 'Primitives/Copyable',
  component: Copyable,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Copyable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShortValue: Story = {
  args: {
    content: 'carrier-gateway',
    children: text('<span>carrier-gateway</span>'),
  },
};

/** Wrapping a preformatted block, as the raw stack trace does. */
export const PreformattedBlock: Story = {
  args: {
    content: 'Error: boom\n    at deep (/proj/src/app.ts:2:9)',
    children: text(
      '<pre style="font-family:monospace;font-size:12px">Error: boom\n    at deep (/proj/src/app.ts:2:9)</pre>',
    ),
  },
};
