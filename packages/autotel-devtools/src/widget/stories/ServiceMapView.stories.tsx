import { h } from 'preact';
import type { Meta, StoryObj } from '@storybook/preact-vite';
import { ServiceMapView } from '../components/ServiceMapView';
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
  title: 'Views/ServiceMapView',
  component: ServiceMapView,
  parameters: {
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
  },
} satisfies Meta<typeof ServiceMapView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const SingleService: Story = {
  play: async () => {
    updateWidgetData({
      traces: [makeTrace({ service: 'api-service' })],
    });
  },
};

export const MultipleServices: Story = {
  play: async () => {
    updateWidgetData({
      traces: [
        makeTrace({ traceId: 't1', service: 'api-gateway' }),
        makeTrace({ traceId: 't2', service: 'user-service' }),
        makeTrace({ traceId: 't3', service: 'order-service' }),
        makeTrace({ traceId: 't4', service: 'payment-service' }),
      ],
    });
  },
};

export const WithErrors: Story = {
  play: async () => {
    updateWidgetData({
      traces: [
        makeTrace({ traceId: 't1', service: 'api-service', status: 'ERROR' }),
        makeTrace({ traceId: 't2', service: 'api-service' }),
        makeTrace({ traceId: 't3', service: 'auth-service', status: 'ERROR' }),
      ],
    });
  },
};

export const ManyServices: Story = {
  play: async () => {
    const services = [
      'api-gateway',
      'user-service',
      'order-service',
      'payment-service',
      'notification-service',
      'analytics-service',
      'search-service',
      'cache-service',
    ];

    updateWidgetData({
      traces: services.map((service, i) =>
        makeTrace({
          traceId: `trace-${i}`,
          service,
          status: i % 5 === 0 ? 'ERROR' : 'OK',
        }),
      ),
    });
  },
};

export const HighTrafficServices: Story = {
  play: async () => {
    const traces: TraceData[] = [];

    for (let i = 0; i < 50; i++) {
      traces.push(makeTrace({ traceId: `api-${i}`, service: 'api-gateway' }));
    }
    for (let i = 0; i < 30; i++) {
      traces.push(makeTrace({ traceId: `user-${i}`, service: 'user-service' }));
    }
    for (let i = 0; i < 25; i++) {
      traces.push(
        makeTrace({ traceId: `order-${i}`, service: 'order-service' }),
      );
    }

    updateWidgetData({ traces });
  },
};

export const WithLogsAndErrors: Story = {
  play: async () => {
    updateWidgetData({
      traces: [
        makeTrace({ traceId: 't1', service: 'api-service' }),
        makeTrace({ traceId: 't2', service: 'worker-service' }),
      ],
      logs: [
        {
          id: 'l1',
          body: 'Log 1',
          timestamp: Date.now(),
          resourceName: 'api-service',
        },
        {
          id: 'l2',
          body: 'Log 2',
          timestamp: Date.now(),
          resourceName: 'api-service',
        },
        {
          id: 'l3',
          body: 'Log 3',
          timestamp: Date.now(),
          resourceName: 'worker-service',
        },
      ],
      errors: [
        {
          fingerprint: 'fp1',
          type: 'Error',
          message: 'Something failed',
          count: 2,
          firstSeen: Date.now() - 1000,
          lastSeen: Date.now(),
          affectedTraces: ['t1'],
          affectedSpans: [],
          service: 'api-service',
        },
      ],
    });
  },
};
