import type { Meta, StoryObj } from '@storybook/svelte-vite';
import ToolCallCard from './ToolCallCard.svelte';
import { firstToolCall } from '../__fixtures__/genai';
import type { GenAiToolCall } from '../../genai/types';

// Catalogue only — no assertions.
//
// The call is taken from a recorded tool run. `firstToolCall()` is optional
// because the recording, not this file, decides whether a tool was called —
// falling back keeps the story renderable either way.

const CALL: GenAiToolCall = firstToolCall() ?? {
  id: 'call_1',
  name: 'get_weather',
  arguments: { city: 'London' },
};

const meta = {
  title: 'GenAI/ToolCallCard',
  component: ToolCallCard,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ToolCallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { call: CALL } };
