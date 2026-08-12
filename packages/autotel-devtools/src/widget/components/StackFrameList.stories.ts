import type { Meta, StoryObj } from '@storybook/svelte-vite';
import StackFrameList from './StackFrameList.svelte';
import { parseStackTrace } from '../../server/parse-stack';

// Catalogue only — no assertions. Behavioural claims live in
// `src/widget/__tests__/StackFrameList.test.ts`.
//
// Fixtures go through the real parser so a story can never show a frame shape
// V8 does not emit.

const APP_AND_DEPS = parseStackTrace(
  'TypeError: cannot read property x of undefined\n' +
    '    at quoteShipment (file:///proj/src/carrier.ts:42:11)\n' +
    '    at async handleRequest (file:///proj/src/server.ts:118:5)\n' +
    '    at emitErrorAndClose (/proj/node_modules/.pnpm/ws@8.21.3/node_modules/ws/lib/websocket.js:1060:13)\n' +
    '    at ClientRequest.emit (node:events:509:28)\n' +
    '    at emitErrorNT (node:internal/streams/destroy:170:8)',
);

const RUNTIME_ONLY = parseStackTrace(
  'Error: boom\n' +
    '    at runScriptInThisContext (node:internal/vm:219:10)\n' +
    '    at node:internal/main/eval_string:71:3',
);

const meta = {
  title: 'Errors/StackFrameList',
  component: StackFrameList,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof StackFrameList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The common case: your frames on top, the machinery below them. */
export const AppAndDependencyFrames: Story = {
  args: { frames: APP_AND_DEPS },
};

/** The second app frame is open in the source peek. */
export const FrameSelected: Story = {
  args: {
    frames: APP_AND_DEPS,
    selected: APP_AND_DEPS.find((f) => f.line === 118) ?? null,
  },
};

/** Nothing actionable — every frame is runtime, so no row is a button. */
export const NoAppFrames: Story = {
  args: { frames: RUNTIME_ONLY },
};

/** An error that arrived with no stack at all. */
export const Empty: Story = {
  args: { frames: [] },
};
