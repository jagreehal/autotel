import type { Meta, StoryObj } from '@storybook/svelte-vite';
import SourcePeek from './SourcePeek.svelte';
import type { SourceWindow } from '../../server/source-file';

// Catalogue only — no assertions. Behavioural claims live in
// `src/widget/__tests__/SourcePeek.test.ts`.
//
// The indentation and highlight are visual claims, so this file is where they
// are checked by eye; the test file deliberately does not assert them.

const MID_FILE: SourceWindow = {
  file: 'src/carrier.ts',
  line: 42,
  startLine: 40,
  lines: [
    'const quote = await carrier.quote(shipment);',
    'if (!quote) {',
    '  throw new TypeError("no quote");',
    '}',
    'return quote;',
  ],
};

const meta = {
  title: 'Errors/SourcePeek',
  component: SourcePeek,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SourcePeek>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The usual case: context either side of the failing line. */
export const MidFile: Story = {
  args: { window: MID_FILE, onopen: () => {} },
};

/** No editor deep-link available, so the button is absent. */
export const WithoutEditorLink: Story = {
  args: { window: MID_FILE },
};

/** Clamped at the top of the file — numbering starts at 1, with no padding. */
export const AtStartOfFile: Story = {
  args: {
    window: {
      file: 'src/index.ts',
      line: 2,
      startLine: 1,
      lines: ["import { init } from 'autotel';", 'init({ service: "api" });'],
    },
    onopen: () => {},
  },
};

/** Deep indentation, to check the leading whitespace survives rendering. */
export const DeeplyIndented: Story = {
  args: {
    window: {
      file: 'src/handler.ts',
      line: 88,
      startLine: 86,
      lines: [
        '      if (attempt < retries) {',
        '        await sleep(backoff(attempt));',
        '            throw new Error("giving up after " + attempt);',
      ],
    },
    onopen: () => {},
  },
};

/** Outside the project root, or generated rather than written. */
export const Unreadable: Story = {
  args: { window: null },
};
