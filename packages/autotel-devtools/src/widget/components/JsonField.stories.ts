import type { Meta, StoryObj } from '@storybook/svelte-vite';
import JsonField from './JsonField.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/JsonField',
  component: JsonField,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof JsonField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StringValue: Story = {
  args: { label: 'http.route', value: '/quote' },
};

export const NumberValue: Story = {
  args: { label: 'http.response.status_code', value: 401 },
};

export const ObjectValue: Story = {
  args: { label: 'attributes', value: { carrier: 'shipfast', retries: 2 } },
};

/** Positive tone, used where a value is the good outcome. */
export const Positive: Story = {
  args: { label: 'status', value: 'OK', tone: 'positive' },
};
