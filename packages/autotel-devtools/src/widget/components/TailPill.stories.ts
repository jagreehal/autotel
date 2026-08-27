import type { Meta, StoryObj } from '@storybook/svelte-vite';
import TailPill from './TailPill.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `*.test.ts`; this file exists so every state is browsable in Storybook.

const meta = {
  title: 'Primitives/TailPill',
  component: TailPill,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TailPill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The common case: frozen, with a handful of new matches waiting. */
export const Frozen: Story = {
  args: { count: 12, live: false, onResume: () => {} },
};

/** A single arrival still reads correctly. */
export const One: Story = {
  args: { count: 1, live: false, onResume: () => {} },
};

/** Past 999 the exact figure stops being useful. */
export const Saturated: Story = {
  args: { count: 4821, live: false, onResume: () => {} },
};

/** Live: nothing to catch up on, so nothing renders. */
export const Live: Story = {
  args: { count: 0, live: true, onResume: () => {} },
};

/** Frozen but nothing pending — also renders nothing. */
export const FrozenEmpty: Story = {
  args: { count: 0, live: false, onResume: () => {} },
};
