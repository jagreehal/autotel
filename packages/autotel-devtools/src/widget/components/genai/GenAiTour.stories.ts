import type { Meta, StoryObj } from '@storybook/svelte-vite';
import GenAiTour from './GenAiTour.svelte';
import { tourSteps } from '../__fixtures__/genai';

// Catalogue only — no assertions. Fixtures come from the real normalisers over
// recorded spans, so no story shows a shape the app cannot produce.

const meta = {
  title: 'GenAI/GenAiTour',
  component: GenAiTour,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GenAiTour>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstStep: Story = {
  args: { steps: tourSteps(), index: 0, onClose: () => {} },
};

/** Part-way through, so both navigation directions are available. */
export const MidTour: Story = {
  args: {
    steps: tourSteps(),
    index: Math.min(1, Math.max(tourSteps().length - 1, 0)),
    onClose: () => {},
  },
};
