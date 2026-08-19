import type { Meta, StoryObj } from '@storybook/svelte-vite';
import RunSummaryBar from './RunSummaryBar.svelte';
import { runSummary } from '../__fixtures__/genai';

// Catalogue only — no assertions. Fixtures come from the real normalisers over
// recorded spans, so no story shows a shape the app cannot produce.

const meta = {
  title: 'GenAI/RunSummaryBar',
  component: RunSummaryBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RunSummaryBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ToolRun: Story = { args: { summary: runSummary() } };
