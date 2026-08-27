import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, screen, waitFor, within } from 'storybook/test';
import TracesView from './TracesView.svelte';
import {
  updateWidgetData,
  clearAllData,
  setPaused,
  pendingTracesSignal,
  setSelectedTrace,
} from '../store.svelte';
import type { TraceData, SpanData } from '../types';

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  const traceId = overrides.traceId ?? 'trace-1';
  return {
    traceId,
    spanId: overrides.spanId ?? 'span-1',
    name: overrides.name ?? 'GET /api/users',
    kind: overrides.kind ?? 'SERVER',
    startTime: overrides.startTime ?? Date.now(),
    endTime: overrides.endTime ?? Date.now() + 100,
    duration: overrides.duration ?? 100,
    attributes: overrides.attributes ?? { 'http.method': 'GET' },
    status: overrides.status ?? { code: 'OK' },
    events: overrides.events ?? [],
    parentSpanId: overrides.parentSpanId,
  };
}

function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  const traceId = overrides.traceId ?? 'trace-1';
  const rootSpan = overrides.rootSpan ?? makeSpan({ traceId });
  return {
    traceId,
    correlationId: overrides.correlationId ?? `corr-${traceId}`,
    rootSpan,
    spans: overrides.spans ?? [rootSpan],
    startTime: overrides.startTime ?? Date.now(),
    endTime: overrides.endTime ?? Date.now() + 100,
    duration: overrides.duration ?? 100,
    status: overrides.status ?? 'OK',
    service: overrides.service ?? 'test-service',
  };
}

const meta = {
  title: 'Views/TracesView',
  component: TracesView,
  parameters: {
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
    setPaused(false);
    setSelectedTrace(null);
    const original = globalThis.fetch;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const href = String(url);
      if (href.endsWith('/api/query/traces/fields')) {
        return new Response(JSON.stringify({ fields: [] }));
      }
      if (href.endsWith('/api/query/traces')) {
        return new Response(JSON.stringify({ traces: [], nextCursor: null }));
      }
      return original(url, init);
    }) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  },
} satisfies Meta<typeof TracesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/No traces yet/)).toBeInTheDocument();
  },
};

export const SingleTrace: Story = {
  play: async ({ canvas, userEvent }) => {
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'trace-1',
          duration: 45,
          rootSpan: makeSpan({ name: 'GET /api/users', duration: 45 }),
        }),
      ],
    });
    await expect(await canvas.findByText('GET /api/users')).toBeInTheDocument();
    await expect(canvas.getByText('Traces (1)')).toBeInTheDocument();

    await userEvent.click(await canvas.findByText('GET /api/users'));
    await expect(await canvas.findByText('Back to traces')).toBeInTheDocument();
  },
};

export const MultipleTraces: Story = {
  play: async ({ canvas }) => {
    const now = Date.now();
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'trace-1',
          startTime: now - 1000,
          rootSpan: makeSpan({ name: 'GET /api/users', startTime: now - 1000 }),
        }),
        makeTrace({
          traceId: 'trace-2',
          startTime: now - 2000,
          rootSpan: makeSpan({
            name: 'POST /api/orders',
            startTime: now - 2000,
          }),
        }),
        makeTrace({
          traceId: 'trace-3',
          startTime: now - 3000,
          duration: 250,
          rootSpan: makeSpan({
            name: 'GET /api/products',
            startTime: now - 3000,
            duration: 250,
          }),
        }),
      ],
    });
    await expect(await canvas.findByText('GET /api/users')).toBeInTheDocument();
    await expect(canvas.getByText('POST /api/orders')).toBeInTheDocument();
    await expect(canvas.getByText('GET /api/products')).toBeInTheDocument();
    await expect(canvas.getByText('Traces (3)')).toBeInTheDocument();
  },
};

export const WithError: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'error-trace-1',
          status: 'ERROR',
          rootSpan: makeSpan({
            name: 'GET /api/fail',
            status: { code: 'ERROR', message: 'Connection refused' },
            events: [
              {
                name: 'exception',
                timestamp: Date.now(),
                attributes: {
                  'exception.type': 'Error',
                  'exception.message': 'Connection refused',
                },
              },
            ],
          }),
        }),
        makeTrace({
          traceId: 'trace-2',
          rootSpan: makeSpan({ name: 'GET /api/success' }),
        }),
      ],
    });
    await expect(await canvas.findByText('GET /api/fail')).toBeInTheDocument();
    await expect(canvas.getByText('GET /api/success')).toBeInTheDocument();
    await expect(canvas.getByText('ERROR')).toBeInTheDocument();
  },
};

export const LongDuration: Story = {
  play: async ({ canvas }) => {
    const now = Date.now();
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'slow-trace',
          startTime: now - 5000,
          duration: 5234,
          rootSpan: makeSpan({
            name: 'GET /api/slow-endpoint',
            startTime: now - 5000,
            duration: 5234,
          }),
        }),
      ],
    });
    await expect(
      await canvas.findByText('GET /api/slow-endpoint'),
    ).toBeInTheDocument();
  },
};

export const SortByDurationColumn: Story = {
  play: async ({ canvas, userEvent }) => {
    const now = Date.now();
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'fast',
          duration: 20,
          rootSpan: makeSpan({ name: 'fast op', duration: 20 }),
          startTime: now,
        }),
        makeTrace({
          traceId: 'slow',
          duration: 900,
          rootSpan: makeSpan({ name: 'slow op', duration: 900 }),
          startTime: now - 1000,
        }),
      ],
    });
    await expect(await canvas.findByText('fast op')).toBeInTheDocument();
    // Clicking the Duration header sorts; descending shows the slow trace first.
    const durationHeader = canvas.getByRole('button', { name: 'Duration' });
    await userEvent.click(durationHeader);
    await expect(canvas.getByText('slow op')).toBeInTheDocument();
    await expect(canvas.getByText('900ms')).toBeInTheDocument();
  },
};

export const MultiSelectAndDelete: Story = {
  play: async ({ canvas, userEvent }) => {
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'trace-1',
          rootSpan: makeSpan({ name: 'GET /api/users' }),
        }),
        makeTrace({
          traceId: 'trace-2',
          rootSpan: makeSpan({ name: 'POST /api/orders' }),
        }),
      ],
    });
    await expect(await canvas.findByText('GET /api/users')).toBeInTheDocument();

    // First checkbox is the "select all" header; row checkboxes follow.
    const checkboxes = await canvas.findAllByRole('checkbox');
    await userEvent.click(checkboxes[1]);

    await expect(canvas.getByText('(1 selected)')).toBeInTheDocument();
    const del = canvas.getByRole('button', { name: /Delete/ });
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    await userEvent.click(del);
    window.confirm = originalConfirm;

    // Selection cleared and the bulk bar is gone.
    await waitFor(() =>
      expect(canvas.queryByText('(1 selected)')).not.toBeInTheDocument(),
    );
    await expect(canvas.getByText('Traces (1)')).toBeInTheDocument();
  },
};

// Locks the dark theme so the token-based theming has a snapshot + visual check.
export const Dark: Story = {
  globals: { theme: 'dark' },
  play: async ({ canvas }) => {
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'trace-1',
          rootSpan: makeSpan({ name: 'GET /api/users' }),
        }),
        makeTrace({
          traceId: 'error-trace',
          status: 'ERROR',
          rootSpan: makeSpan({
            name: 'GET /api/fail',
            status: { code: 'ERROR', message: 'boom' },
          }),
        }),
      ],
    });
    await expect(await canvas.findByText('GET /api/users')).toBeInTheDocument();
    await expect(canvas.getByText('ERROR')).toBeInTheDocument();
  },
};

/**
 * Narrowing the global time window drops traces that fall outside it.
 *
 * Previously driven by a Traces-only dropdown; that control is gone, replaced
 * by the window shared with every other tab. The behaviour is the same, so the
 * coverage moves rather than disappearing.
 */
export const TimeRangeFilter: Story = {
  play: async ({ canvas, userEvent }) => {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'fresh',
          startTime: now,
          rootSpan: makeSpan({ name: 'fresh op', startTime: now }),
        }),
        makeTrace({
          traceId: 'old',
          startTime: twoHoursAgo,
          rootSpan: makeSpan({ name: 'old op', startTime: twoHoursAgo }),
        }),
      ],
    });
    // Both visible under the default, unbounded "All time".
    await expect(await canvas.findByText('fresh op')).toBeInTheDocument();
    await expect(canvas.getByText('old op')).toBeInTheDocument();

    // Narrow to the last 5 minutes — the 2h-old trace drops out.
    //
    // The popover is *portalled*, so it lands outside the story's canvas and a
    // canvas-scoped query cannot see it. That is the same behaviour the
    // shadow-DOM portal test pins; here there is no shadow root, so it goes to
    // the document — hence `screen` rather than `canvas`.
    await userEvent.click(canvas.getByLabelText('Time window'));
    const presets = await screen.findByRole('group', { name: 'Presets' });
    await userEvent.click(within(presets).getByText('Last 5m'));

    await expect(canvas.queryByText('old op')).not.toBeInTheDocument();
    await expect(canvas.getByText('fresh op')).toBeInTheDocument();
  },
};

export const PausedWithBuffer: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'shown-1',
          rootSpan: makeSpan({ name: 'GET /api/users' }),
        }),
      ],
    });
    setPaused(true);
    pendingTracesSignal.value = [
      makeTrace({
        traceId: 'pending-1',
        rootSpan: makeSpan({ name: 'POST /api/orders' }),
      }),
      makeTrace({
        traceId: 'pending-2',
        rootSpan: makeSpan({ name: 'GET /api/products' }),
      }),
      makeTrace({
        traceId: 'pending-3',
        rootSpan: makeSpan({ name: 'POST /api/checkout' }),
      }),
    ];
    await expect(await canvas.findByText('Resume (+3)')).toBeInTheDocument();
    await expect(canvas.getByText('GET /api/users')).toBeInTheDocument();
    await expect(canvas.getByText('Drop buffer')).toBeInTheDocument();
  },
};
