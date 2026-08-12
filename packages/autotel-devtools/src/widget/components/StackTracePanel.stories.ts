import type { Meta, StoryObj } from '@storybook/svelte-vite';
import StackTracePanel from './StackTracePanel.svelte';
import type { SourceLoader } from '../source-client';

// Catalogue only — no assertions. Behavioural claims live in
// `src/widget/__tests__/StackTracePanel.test.ts`.
//
// The loader is injected, so these stories need no network and no MSW: each one
// declares what the receiver would have answered.

const STACK =
  'TypeError: cannot read property x of undefined\n' +
  '    at quoteShipment (file:///proj/src/carrier.ts:42:11)\n' +
  '    at async handleRequest (file:///proj/src/server.ts:118:5)\n' +
  '    at emitErrorAndClose (/proj/node_modules/ws/lib/websocket.js:1060:13)\n' +
  '    at ClientRequest.emit (node:events:509:28)';

const found: SourceLoader = async (frame) => ({
  file: frame.file.replace('/proj/', ''),
  line: frame.line,
  startLine: Math.max(1, frame.line - 2),
  lines: [
    'const quote = await carrier.quote(shipment);',
    'if (!quote) {',
    '  throw new TypeError("no quote");',
    '}',
    'return quote;',
  ],
});

const missing: SourceLoader = async () => null;

const meta = {
  title: 'Errors/StackTracePanel',
  component: StackTracePanel,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof StackTracePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Frames listed; nothing fetched until one is chosen. */
export const Frames: Story = {
  args: { stackTrace: STACK, loadSource: found },
};

/** The receiver has no source for the frame (outside the root, or generated). */
export const SourceUnavailable: Story = {
  args: { stackTrace: STACK, loadSource: missing },
};

/** An error thrown with no stack renders nothing at all. */
export const NoFrames: Story = {
  args: { stackTrace: 'Error: thrown with no stack', loadSource: missing },
};
