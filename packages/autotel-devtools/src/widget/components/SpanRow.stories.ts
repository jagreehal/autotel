import type { Meta, StoryObj } from '@storybook/svelte-vite';
import SpanRow from './SpanRow.svelte';
import { makeTrace, makeFailedTrace, makeSpan } from './__fixtures__/telemetry';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Traces/SpanRow',
  component: SpanRow,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SpanRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ok: Story = {
  args: {
    span: makeSpan(),
    trace: makeTrace(),
    isSelected: false,
    onSelect: () => {},
  },
};

export const Selected: Story = {
  args: {
    span: makeSpan(),
    trace: makeTrace(),
    isSelected: true,
    onSelect: () => {},
  },
};

export const Errored: Story = {
  args: {
    span: makeFailedTrace().rootSpan,
    trace: makeFailedTrace(),
    isSelected: false,
    onSelect: () => {},
  },
};
