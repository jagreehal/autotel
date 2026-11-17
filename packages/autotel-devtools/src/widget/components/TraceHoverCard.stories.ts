import type { Meta, StoryObj } from '@storybook/svelte-vite';
import TraceHoverCard from './TraceHoverCard.svelte';
import { makeBatchSendTrace, makeTrace } from './__fixtures__/telemetry';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Traces/TraceHoverCard',
  component: TraceHoverCard,
} satisfies Meta<typeof TraceHoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A failed batch: the error, where the time went, the app's attributes. */
export const FailedBatch: Story = {
  args: { trace: makeBatchSendTrace() },
};

/** A trace across two services, no errors. */
export const AcrossServices: Story = {
  args: { trace: makeTrace() },
};
