import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect } from 'storybook/test'
import ConnectionStatus from './ConnectionStatus.svelte'
import { connectionStatusSignal } from '../store.svelte'

// ConnectionStatus reads connectionStatusSignal; each story seeds it.
function seed(status: string): () => void {
  const prev = connectionStatusSignal.value
  connectionStatusSignal.value = status
  return () => {
    connectionStatusSignal.value = prev
  }
}

const meta = {
  title: 'Chrome/ConnectionStatus',
  component: ConnectionStatus,
} satisfies Meta<typeof ConnectionStatus>
export default meta
type Story = StoryObj<typeof meta>

export const Connected: Story = {
  beforeEach: () => seed('connected'),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Connected')).toBeInTheDocument()
  },
}

export const Connecting: Story = {
  beforeEach: () => seed('connecting'),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Connecting…')).toBeInTheDocument()
  },
}

export const Disconnected: Story = {
  beforeEach: () => seed('disconnected'),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Disconnected')).toBeInTheDocument()
  },
}

export const Compact: Story = {
  args: { compact: true },
  beforeEach: () => seed('connected'),
  play: async ({ canvas }) => {
    // Compact renders the dot only — no label text.
    await expect(canvas.queryByText('Connected')).not.toBeInTheDocument()
  },
}
