import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect } from 'storybook/test'
import ContextWindowGauge from './ContextWindowGauge.svelte'

const meta = {
  title: 'GenAI/ContextWindowGauge',
  component: ContextWindowGauge,
} satisfies Meta<typeof ContextWindowGauge>
export default meta
type Story = StoryObj<typeof meta>

export const Comfortable: Story = {
  args: { used: 24_000, total: 128_000, size: 40 },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('19%')).toBeInTheDocument()
  },
}

export const Tight: Story = {
  args: { used: 96_000, total: 128_000, size: 40 },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('75%')).toBeInTheDocument()
  },
}

export const NearlyFull: Story = {
  args: { used: 122_000, total: 128_000, size: 40 },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('95%')).toBeInTheDocument()
  },
}

export const OverBudget: Story = {
  // Prompt exceeds the window — the arc clamps at 100%.
  args: { used: 200_000, total: 128_000, size: 40 },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('100%')).toBeInTheDocument()
  },
}
