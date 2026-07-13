import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent } from 'storybook/test'
import FacetFilter from './FacetFilter.svelte'
import type { Facet } from './facetFilter.types'

// A static facet set. onToggle is a no-op here — the stories exercise the
// popover chrome (open, counts, active state), not the parent's filter state.
function serviceFacet(selected: string[] = []): Facet {
  return {
    key: 'service',
    label: 'Service',
    options: [
      { value: 'checkout-api', count: 42 },
      { value: 'payments', count: 17 },
      { value: 'inventory', count: 9 },
      { value: 'notifications', count: 3 },
    ],
    selected: new Set(selected),
    onToggle: () => {},
  }
}

const meta = {
  title: 'Chrome/FacetFilter',
  component: FacetFilter,
} satisfies Meta<typeof FacetFilter>
export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  args: { facets: [serviceFacet()], onClearAll: () => {} },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Filter')).toBeInTheDocument()
  },
}

export const Open: Story = {
  args: { facets: [serviceFacet()], onClearAll: () => {} },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByText('Filter'))
    // The facet section title and an option with its count are visible.
    await expect(await canvas.findByText('Service')).toBeInTheDocument()
    await expect(await canvas.findByText('checkout-api')).toBeInTheDocument()
    await expect(await canvas.findByText('42')).toBeInTheDocument()
  },
}

export const WithActiveSelection: Story = {
  args: {
    facets: [serviceFacet(['payments', 'inventory'])],
    onClearAll: () => {},
  },
  play: async ({ canvas }) => {
    // The active-count badge on the button reflects the two selected values.
    await expect(await canvas.findByText('2')).toBeInTheDocument()
  },
}
