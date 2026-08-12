import type { Meta, StoryObj } from '@storybook/svelte-vite';
import SearchInput from './SearchInput.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/SearchInput',
  component: SearchInput,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { value: '', placeholder: 'Search traces…' },
};

/** With a value, the clear button appears. */
export const WithQuery: Story = {
  args: { value: 'checkout', placeholder: 'Search traces…' },
};

export const CustomLabel: Story = {
  args: {
    value: '',
    placeholder: 'Filter errors…',
    ariaLabel: 'Filter errors',
    clearTitle: 'Clear error filter',
  },
};
