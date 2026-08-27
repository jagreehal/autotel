import type { Meta, StoryObj } from '@storybook/svelte-vite';
import QueryBar from './QueryBar.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/QueryBar',
  component: QueryBar,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof QueryBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

export const Empty: Story = {
  args: { value: '', onInput: noop, onSubmit: noop },
};

export const ValidQuery: Story = {
  args: {
    value: 'service = api AND duration > 100',
    onInput: noop,
    onSubmit: noop,
  },
};

/** Focus the input to browse columns and attributes observed by the server. */
export const FieldCompletion: Story = {
  args: {
    value: 'http.',
    onInput: noop,
    onSubmit: noop,
    fields: ['http.method', 'http.route', 'http.status_code', 'service'],
  },
};

/** Free text needs no field or operator. */
export const FreeText: Story = {
  args: { value: 'checkout', onInput: noop, onSubmit: noop },
};

/** Mid-edit: the operator has no value yet, so the error names the column. */
export const Incomplete: Story = {
  args: { value: 'service =', onInput: noop, onSubmit: noop },
};

export const UnclosedParen: Story = {
  args: {
    value: '(service = api AND duration > 100',
    onInput: noop,
    onSubmit: noop,
  },
};

/** An error the client grammar accepts but the server rejected. */
export const ServerError: Story = {
  args: {
    value: 'service = api',
    onInput: noop,
    onSubmit: noop,
    serverErrors: [
      { message: 'Unknown field "srvice"', range: { from: 0, to: 6 } },
    ],
  },
};
