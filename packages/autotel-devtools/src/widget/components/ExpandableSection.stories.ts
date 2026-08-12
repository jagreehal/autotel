import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
import ExpandableSection from './ExpandableSection.svelte';

// Catalogue only — no assertions. `expanded` is controlled by the parent, so
// each story pins one state rather than toggling.

const body = createRawSnippet(() => ({
  render: () => '<p style="font-size:12px">Section contents</p>',
}));

const meta = {
  title: 'Primitives/ExpandableSection',
  component: ExpandableSection,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ExpandableSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  args: {
    label: 'Attributes',
    expanded: false,
    onToggle: () => {},
    children: body,
  },
};

export const Expanded: Story = {
  args: {
    label: 'Attributes',
    expanded: true,
    onToggle: () => {},
    children: body,
  },
};
