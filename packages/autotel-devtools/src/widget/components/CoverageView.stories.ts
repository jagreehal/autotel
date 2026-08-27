import type { Meta, StoryObj } from '@storybook/svelte-vite';
import CoverageView from './CoverageView.svelte';

// Catalogue only — no assertions. Behavioural claims belong in the paired
// `__tests__/CoverageView.test.ts`.

const meta = {
  title: 'Views/Coverage',
  component: CoverageView,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CoverageView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Stub `fetch` for the story and restore it on teardown. */
function respondWith(status: number, body: unknown) {
  return () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    return () => {
      globalThis.fetch = real;
    };
  };
}

/** The normal case: some handlers are dark, and they sort to the top. */
export const SomeDark: Story = {
  beforeEach: respondWith(200, {
    total: 4,
    seenCount: 2,
    entries: [
      {
        method: 'POST',
        path: '/orders',
        file: 'src/routes/orders.ts',
        handler: { line: 18 },
        seen: false,
        spanCount: 0,
      },
      {
        method: null,
        path: 'sendReceiptEmail',
        file: 'src/jobs/email.ts',
        handler: { line: 7 },
        seen: false,
        spanCount: 0,
      },
      {
        method: 'GET',
        path: '/users',
        file: 'src/routes/users.ts',
        seen: true,
        spanCount: 1284,
      },
      {
        method: 'GET',
        path: '/health',
        file: 'src/routes/health.ts',
        seen: true,
        spanCount: 43,
      },
    ],
  }),
};

/** Everything the map found has emitted at least once. */
export const FullyCovered: Story = {
  beforeEach: respondWith(200, {
    total: 2,
    seenCount: 2,
    entries: [
      {
        method: 'GET',
        path: '/users',
        file: 'src/routes/users.ts',
        seen: true,
        spanCount: 1284,
      },
      {
        method: 'GET',
        path: '/health',
        file: 'src/routes/health.ts',
        seen: true,
        spanCount: 43,
      },
    ],
  }),
};

/** No map has been generated, which is not the same as full coverage. */
export const NoMap: Story = {
  beforeEach: respondWith(404, {
    error: 'No instrumentation map',
    message:
      "Run `npx autotel map` to record this project's entry points, then reload.",
  }),
};
