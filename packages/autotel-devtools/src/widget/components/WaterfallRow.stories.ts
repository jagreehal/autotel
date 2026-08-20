import type { Meta, StoryObj } from '@storybook/svelte-vite';
import WaterfallRow from './WaterfallRow.svelte';
import {
  makeTrace,
  makeFailedTrace,
  makeSpanNode,
} from './__fixtures__/telemetry';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Traces/WaterfallRow',
  component: WaterfallRow,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WaterfallRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Leaf: Story = {
  args: {
    node: makeSpanNode(),
    trace: makeTrace(),
    isSelected: false,
    isCollapsed: false,
    hasChildren: false,
    isCritical: false,
  },
};

export const WithChildren: Story = {
  args: {
    node: makeSpanNode(),
    trace: makeTrace(),
    isSelected: false,
    isCollapsed: false,
    hasChildren: true,
    isCritical: false,
  },
};

export const Collapsed: Story = {
  args: {
    node: makeSpanNode(),
    trace: makeTrace(),
    isSelected: false,
    isCollapsed: true,
    hasChildren: true,
    isCritical: false,
  },
};

/** On the critical path — the span that determined the trace's duration. */
export const Critical: Story = {
  args: {
    node: makeSpanNode(),
    trace: makeTrace(),
    isSelected: false,
    isCollapsed: false,
    hasChildren: false,
    isCritical: true,
  },
};

export const Errored: Story = {
  args: {
    node: makeSpanNode(makeFailedTrace().rootSpan),
    trace: makeFailedTrace(),
    isSelected: true,
    isCollapsed: false,
    hasChildren: false,
    isCritical: false,
  },
};
