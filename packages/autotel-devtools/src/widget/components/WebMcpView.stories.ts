import type { Meta, StoryObj } from '@storybook/svelte-vite';
import WebMcpView from './WebMcpView.svelte';
import { makeInventory, makeTool } from './__fixtures__/webmcp';
import type { WebMcpInventory } from '../types';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `__tests__/WebMcpView.test.ts`.

const meta = {
  title: 'Views/WebMCP',
  component: WebMcpView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WebMcpView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Stub `fetch` for the story and restore it on teardown. */
function respondWith(webmcp: WebMcpInventory) {
  return () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ webmcp }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    return () => {
      globalThis.fetch = real;
    };
  };
}

/** A healthy surface: every tool on offer, nothing mangled on the way. */
export const Healthy: Story = {
  beforeEach: respondWith(
    makeInventory([
      makeTool({ name: 'list_issues', calls: 12, medianResultBytes: 480 }),
      makeTool({ name: 'get_issue_summary', calls: 4 }),
      makeTool({ name: 'highlight_issues', calls: 2 }),
    ]),
  ),
};

/** The reason the tab exists: what the browser did to the tools on the way. */
export const Mangled: Story = {
  beforeEach: respondWith(
    makeInventory([
      makeTool({
        name: 'approve_alias',
        annotationsSent: ['readOnlyHint', 'destructiveHint'],
        annotationsDropped: ['destructiveHint'],
        calls: 8,
      }),
      makeTool({
        name: 'find_similar',
        calls: 20,
        envelopeCalls: 20,
        resultBytes: 900,
        medianResultBytes: 45,
      }),
      makeTool({
        name: 'apply_to_similar',
        hasInputSchema: false,
        calls: 1,
        substitutedCalls: 1,
      }),
      makeTool({ name: 'ignore_issue', offered: false, calls: 3, errors: 1 }),
    ]),
  ),
};

/** Instrumented after the tools registered: an installation that saw nothing. */
export const InstrumentedTooLate: Story = {
  beforeEach: respondWith(
    makeInventory(
      [
        makeTool({
          name: 'checkout',
          observedAtRegistration: false,
          offered: false,
          calls: 6,
        }),
      ],
      { installations: 2, emptyInstallations: 1 },
    ),
  ),
};

/** Where nearly every reader lands, since WebMCP is behind a Chrome flag. */
export const Empty: Story = {
  beforeEach: respondWith(makeInventory([])),
};
