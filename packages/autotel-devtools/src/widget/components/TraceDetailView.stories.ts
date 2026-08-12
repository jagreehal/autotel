import type { Meta, StoryObj } from '@storybook/svelte-vite';
import TraceDetailView from './TraceDetailView.svelte';
import { makeTrace, makeFailedTrace } from './__fixtures__/telemetry';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Traces/TraceDetailView',
  component: TraceDetailView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TraceDetailView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { trace: makeTrace() } };

export const Errored: Story = { args: { trace: makeFailedTrace() } };
