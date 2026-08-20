import type { Meta, StoryObj } from '@storybook/svelte-vite';
import AgentTimeline from './AgentTimeline.svelte';
import { timelineRows } from '../__fixtures__/genai';

// Catalogue only — no assertions. Fixtures come from the real normalisers over
// recorded spans, so no story shows a shape the app cannot produce.

const meta = {
  title: 'GenAI/AgentTimeline',
  component: AgentTimeline,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AgentTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ToolRun: Story = { args: { rows: timelineRows() } };

export const SpanSelected: Story = {
  args: {
    rows: timelineRows(),
    selectedSpanId: timelineRows()[0]?.normalized.spanId ?? null,
    onSelectSpan: () => {},
  },
};

export const Empty: Story = { args: { rows: [] } };
