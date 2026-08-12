import type { Meta, StoryObj } from '@storybook/svelte-vite';
import IdRow from './IdRow.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/IdRow',
  component: IdRow,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof IdRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
  args: { label: 'Trace ID', value: '98e054dea7a5ea8feea2f5a3774f147c' },
};

/** Activatable — the value becomes a link, e.g. jump to the parent span. */
export const Activatable: Story = {
  args: {
    label: 'Parent span',
    value: '8f0efef378bf0e7e',
    onActivate: () => {},
    activateTitle: 'Go to parent span',
  },
};
