import type { Meta, StoryObj } from '@storybook/svelte-vite';
import ConversationPanel from './ConversationPanel.svelte';
import { chatSpan } from '../__fixtures__/genai';

// Catalogue only — no assertions. Fixtures come from the real normalisers over
// recorded spans, so no story shows a shape the app cannot produce.

const meta = {
  title: 'GenAI/ConversationPanel',
  component: ConversationPanel,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ConversationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChatCompletion: Story = { args: { span: chatSpan() } };
