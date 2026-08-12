import type { Meta, StoryObj } from '@storybook/svelte-vite';
import ModelHeader from './ModelHeader.svelte';
import {
  chatSpan,
} from '../__fixtures__/genai';

// Catalogue only — no assertions. Fixtures come from the real normalisers over
// recorded spans, so no story shows a shape the app cannot produce.

const meta = {
  title: 'GenAI/ModelHeader',
  component: ModelHeader,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ModelHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { span: chatSpan() } };

/** With a trace link, the `trace …` reference becomes clickable. */
export const WithTraceLink: Story = {
  args: { span: chatSpan(), onOpenTrace: () => {} },
};
