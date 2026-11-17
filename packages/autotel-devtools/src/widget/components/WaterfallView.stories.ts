import type { Meta, StoryObj } from '@storybook/svelte-vite';
import WaterfallView from './WaterfallView.svelte';
import {
  makeTrace,
  makeFailedTrace,
  makeBatchSendTrace,
} from './__fixtures__/telemetry';

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

/** Hover a span name to see the full name plus timing, status and key attributes. */
export const HoverCard: Story = {
  args: { trace: makeTrace() },
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByText('carrier.quote'));
  },
};

/** The name column remembers its width; drag the header handle to widen it. */
export const WideNameColumn: Story = {
  args: { trace: makeTrace() },
  beforeEach: () => {
    window.localStorage.setItem('autotel-devtools:waterfall-name-width', '360');
    return () =>
      window.localStorage.removeItem('autotel-devtools:waterfall-name-width');
  },
};

/**
 * Rows show the first attributes the app set, so five `statements.send_user`
 * siblings read as u1…u5 and the failed one is visible without a click.
 * Resource and auto-instrumentation attributes stay off the rows.
 */
export const AppAttributesOnRows: Story = {
  args: { trace: makeBatchSendTrace() },
};

/** The hover card lists the app's attributes in full, above the protocol ones. */
export const AppAttributesHoverCard: Story = {
  args: { trace: makeBatchSendTrace() },
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getAllByText('statements.send_user')[3]!);
  },
};

/** A narrow viewer: the span name keeps its room, the attributes truncate. */
export const AppAttributesNarrow: Story = {
  args: { trace: makeBatchSendTrace() },
  globals: { viewport: { value: 'tablet', isRotated: false } },
};
