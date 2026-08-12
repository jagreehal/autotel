import type { Meta, StoryObj } from '@storybook/svelte-vite';
import WaterfallView from './WaterfallView.svelte';
import { makeTrace, makeFailedTrace } from './__fixtures__/telemetry';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Traces/WaterfallView',
  component: WaterfallView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WaterfallView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { trace: makeTrace() } };

export const Errored: Story = { args: { trace: makeFailedTrace() } };

/** A query highlights matching spans by name or service. */
export const Filtered: Story = {
  args: { trace: makeTrace(), query: 'carrier' },
};

export const SpanSelected: Story = {
  args: { trace: makeTrace(), selectedSpanId: 'span-2' },
};
