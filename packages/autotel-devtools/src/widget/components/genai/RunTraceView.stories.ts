import type { Meta, StoryObj } from '@storybook/svelte-vite';
import RunTraceView from './RunTraceView.svelte';
import {
  agentRunNodes,
  failedRunNodes,
  liveRunNodes,
  pricedRunNodes,
  runTraceNodes,
} from '../__fixtures__/genai';

// Catalogue only — no assertions. Fixtures come from the real normalisers over
// recorded spans, so no story shows a shape the app cannot produce.

const meta = {
  title: 'GenAI/RunTraceView',
  component: RunTraceView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RunTraceView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ToolRun: Story = { args: { nodes: runTraceNodes() } };

export const AgentRun: Story = { args: { nodes: agentRunNodes() } };

export const PricedCall: Story = { args: { nodes: pricedRunNodes() } };

export const FailedTool: Story = { args: { nodes: failedRunNodes() } };

/** A parent still running: its children have arrived and it has not. */
export const Live: Story = { args: liveRunNodes() };

export const Empty: Story = { args: { nodes: [] } };
