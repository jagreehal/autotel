import type { Meta, StoryObj } from '@storybook/svelte-vite';
import TreeGutter from './TreeGutter.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/TreeGutter',
  component: TreeGutter,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TreeGutter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A root row: nothing to connect to. */
export const Root: Story = {
  args: { ancestorLines: [], isLast: true },
};

/** A middle child — a tee, because a sibling follows. */
export const MiddleChild: Story = {
  args: { ancestorLines: [], isLast: false },
};

/** The last child — an elbow, so no line runs on to a sibling that isn't there. */
export const LastChild: Story = {
  args: { ancestorLines: [], isLast: true },
};

/** Nested, with an ancestor whose siblings continue past this row. */
export const NestedUnderContinuingAncestor: Story = {
  args: { ancestorLines: [true], isLast: false },
};

/** Deeply nested, mixing continuing and finished ancestor levels. */
export const DeeplyNested: Story = {
  args: { ancestorLines: [true, false, true, false], isLast: true },
};
