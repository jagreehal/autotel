import { h } from 'preact';
import type { Meta, StoryObj } from '@storybook/preact-vite';
import { TracesView } from '../components/TracesView';
import { updateWidgetData, clearAllData } from '../store';
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
  },
} satisfies Meta<typeof TracesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const SingleTrace: Story = {
  play: async () => {
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'trace-1',
          duration: 45,
          rootSpan: makeSpan({ name: 'GET /api/users', duration: 45 }),
        }),
      ],
    });
  },
};

export const MultipleTraces: Story = {
  play: async () => {
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
  },
};

export const WithError: Story = {
  play: async () => {
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
  },
};

export const LongDuration: Story = {
  play: async () => {
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
  },
};
