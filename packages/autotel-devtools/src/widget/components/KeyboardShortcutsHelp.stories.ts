import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp.svelte';
import type { Shortcut } from '../shortcuts';
import { isMac } from '../utils/keyboard';

const SAMPLE_SHORTCUTS: Shortcut[] = [
  { keys: ['/'], description: 'Focus search filter' },
  { keys: ['Esc'], description: 'Clear search or go back' },
  { keys: ['n', 'Shift+N'], description: 'Next / previous search match' },
  { keys: ['e', 'Shift+E'], description: 'Next / previous error span' },
  {
    keys: ['w', 'f', 'l'],
    description: 'Switch view mode (waterfall / flame / list)',
  },
  { keys: ['CmdOrCtrl', 'K'], description: 'Command palette' },
  { keys: ['AltOrOpt', 'Backspace'], description: 'Clear all traces' },
  { keys: ['?'], description: 'Show/hide keyboard shortcuts' },
];

const meta = {
  title: 'Views/KeyboardShortcutsHelp',
  component: KeyboardShortcutsHelp,
  parameters: { layout: 'fullscreen' },
  args: {
    shortcuts: SAMPLE_SHORTCUTS,
    // Mirrors the Preact Wrapper's open/close state: onClose unmounts the
    // dialog so the close-button play function can assert it leaves the DOM.
    onClose: () => {
      document
        .querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]')
        ?.remove();
    },
  },
} satisfies Meta<typeof KeyboardShortcutsHelp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeInTheDocument();
    await expect(canvas.getByText('Focus search filter')).toBeInTheDocument();
    await expect(
      canvas.getByText('Clear search or go back'),
    ).toBeInTheDocument();
    // Verify platform-adaptive key rendering: ⌘/⌥ on macOS, Ctrl/Alt elsewhere
    // (the component reads the same `isMac`, so this holds on Linux CI too).
    await expect(canvas.getByText(isMac ? '⌘' : 'Ctrl')).toBeInTheDocument();
    await expect(canvas.getByText(isMac ? '⌥' : 'Alt')).toBeInTheDocument();
  },
};

export const CloseButtonWorks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeInTheDocument();
    const closeBtn = within(dialog).getByTitle('Close (Esc)');
    await userEvent.click(closeBtn);
    await expect(
      canvas.queryByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).not.toBeInTheDocument();
  },
};
