import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import AgentsView from './AgentsView.svelte';
import { updateWidgetData, clearAllData } from '../store.svelte';
import { sampleAgentSessions } from './__fixtures__/agents';

const meta = {
  title: 'Views/AgentsView',
  component: AgentsView,
  parameters: {
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
  },
} satisfies Meta<typeof AgentsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/Waiting for coding-agent telemetry/),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/npx autotel-devtools claude/)).toBeInTheDocument();
  },
};

export const Populated: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({ agents: sampleAgentSessions() });

    // detail header (full id, unique) + truncated list entry for the other session
    await expect(await canvas.findByText('sess-feature-build')).toBeInTheDocument();
    await expect(canvas.getByText(/sess-qui/)).toBeInTheDocument();

    // breakdowns surfaced (mcp:github also appears in the timeline → allow many)
    await expect((await canvas.findAllByText(/mcp:github/)).length).toBeGreaterThan(0);
    await expect(canvas.getByText(/Explore/)).toBeInTheDocument();
    await expect(canvas.getByText(/tdd/)).toBeInTheDocument();
  },
};

export const SubAgentAndSkillFocus: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({ agents: sampleAgentSessions() });
    // The rich session is selected by default (most recently active first); its
    // per-tool breakdown + timeline list the Task sub-agent and Skill calls, so
    // these names appear more than once.
    await expect((await canvas.findAllByText('Task')).length).toBeGreaterThan(0);
    await expect(canvas.getAllByText('Skill').length).toBeGreaterThan(0);
    await expect(canvas.getAllByText('mcp__github__create_issue').length).toBeGreaterThan(0);
  },
};
