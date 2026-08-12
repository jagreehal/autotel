import type { Meta, StoryObj } from '@storybook/svelte-vite';
import Widget from './Widget.svelte';

// Catalogue only — no assertions.
//
// The WebSocket URL points at a port nothing is listening on, deliberately: a
// story must not depend on a running receiver, and "disconnected" is a real
// state worth being able to look at.

const DEAD_WS = 'ws://127.0.0.1:1/ws';

const meta = {
  title: 'Chrome/Widget',
  component: Widget,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Widget>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full-page shell, as served at `/`. */
export const FullPage: Story = {
  args: { mode: 'fullpage', wsUrl: DEAD_WS },
};

/** Docked into a host app via the custom element. */
export const DockedWidget: Story = {
  args: { mode: 'widget', wsUrl: DEAD_WS },
};
