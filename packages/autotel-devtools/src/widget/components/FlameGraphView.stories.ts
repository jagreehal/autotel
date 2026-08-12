import type { Meta, StoryObj } from '@storybook/svelte-vite';
import FlameGraphView from './FlameGraphView.svelte';
import { makeTrace, makeFailedTrace } from './__fixtures__/telemetry';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Traces/FlameGraphView',
  component: FlameGraphView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FlameGraphView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { trace: makeTrace() } };

export const Errored: Story = { args: { trace: makeFailedTrace() } };

export const SpanSelected: Story = {
  args: { trace: makeTrace(), selectedSpanId: 'span-2' },
};
