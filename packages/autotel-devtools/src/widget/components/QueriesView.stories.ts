import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import QueriesView from './QueriesView.svelte';
import { updateWidgetData, clearAllData } from '../store.svelte';
import { sampleQueryTraces } from './__fixtures__/queries';

const meta = {
  title: 'Views/QueriesView',
  component: QueriesView,
  parameters: {
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
  },
} satisfies Meta<typeof QueriesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/No database spans in this window/),
    ).toBeInTheDocument();
  },
};

// A Postgres N+1 (one comments query per post), and a MongoDB find that
// scanned its collection before the suggested index made it a FETCH.
export const NPlusOneAndFullScan: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({ traces: sampleQueryTraces() });
    await expect(await canvas.findByText('Queries (6)')).toBeInTheDocument();
    await expect(canvas.getByText('Repeated ×5')).toBeInTheDocument();
    await expect(canvas.getByText('FULL SCAN')).toBeInTheDocument();
  },
};
