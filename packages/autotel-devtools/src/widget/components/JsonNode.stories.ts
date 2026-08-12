import type { Meta, StoryObj } from '@storybook/svelte-vite';
import JsonNode from './JsonNode.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/JsonNode',
  component: JsonNode,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof JsonNode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Leaf: Story = { args: { value: 'shipfast', depth: 0 } };

export const Labelled: Story = {
  args: { label: 'carrier', value: 'shipfast', depth: 0 },
};

export const NestedObject: Story = {
  args: {
    label: 'request',
    value: { method: 'GET', headers: { accept: 'application/json' } },
    depth: 0,
  },
};

export const Nested: Story = {
  args: { label: 'retries', value: [1, 2, 3], depth: 2 },
};
