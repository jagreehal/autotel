import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import ServiceMapView from './ServiceMapView.svelte';
import { updateWidgetData, clearAllData } from '../store.svelte';
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

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/No traces available to build service map/),
    ).toBeInTheDocument();
  },
};

export const SingleService: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      traces: [makeTrace({ service: 'api-service' })],
    });
    await expect(await canvas.findByText('Service Map (1 services)')).toBeInTheDocument();
    await expect(canvas.getByText('api-service')).toBeInTheDocument();
  },
};

export const MultipleServices: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      traces: [
        makeTrace({ traceId: 't1', service: 'api-gateway' }),
        makeTrace({ traceId: 't2', service: 'user-service' }),
        makeTrace({ traceId: 't3', service: 'order-service' }),
        makeTrace({ traceId: 't4', service: 'payment-service' }),
      ],
    });
    await expect(await canvas.findByText('Service Map (4 services)')).toBeInTheDocument();
    await expect(canvas.getByText('api-gateway')).toBeInTheDocument();
    await expect(canvas.getByText('user-service')).toBeInTheDocument();
  },
};

export const ConnectedWithErrorEdge: Story = {
  play: async ({ canvas }) => {
    const t0 = Date.now();
    const s = (o: Partial<SpanData>) =>
      makeSpan({ traceId: 'tc', startTime: t0, endTime: t0 + 100, ...o });
    updateWidgetData({
      traces: [
        makeTrace({
          traceId: 'tc',
          service: 'frontend',
          rootSpan: s({ spanId: 'root', name: 'GET /checkout', kind: 'SERVER' }),
          spans: [
            s({ spanId: 'root', name: 'GET /checkout', kind: 'SERVER' }),
            s({
              spanId: 'c1',
              name: 'call backend',
              kind: 'CLIENT',
              parentSpanId: 'root',
              duration: 900,
              attributes: { 'peer.service': 'backend-api' },
            }),
            s({
              spanId: 'c2',
              name: 'query db',
              kind: 'CLIENT',
              parentSpanId: 'root',
              duration: 150,
              status: { code: 'ERROR' },
              attributes: { 'peer.service': 'database', 'db.system': 'postgres' },
            }),
          ],
        }),
      ],
    });
    await expect(await canvas.findByText('frontend')).toBeInTheDocument();
    await expect(canvas.getByText('backend-api')).toBeInTheDocument();
    await expect(canvas.getByText('database')).toBeInTheDocument();
  },
};

export const WithErrors: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      traces: [
        makeTrace({ traceId: 't1', service: 'api-service', status: 'ERROR' }),
        makeTrace({ traceId: 't2', service: 'api-service' }),
        makeTrace({ traceId: 't3', service: 'auth-service', status: 'ERROR' }),
      ],
    });
    await expect(await canvas.findByText('Service Map (2 services)')).toBeInTheDocument();
    await expect(canvas.getByText('Has Errors')).toBeInTheDocument();
  },
};

export const ManyServices: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('Service Map (8 services)')).toBeInTheDocument();
    await expect(canvas.getByText(/cache-serv/)).toBeInTheDocument();
  },
};

export const HighTrafficServices: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('Service Map (3 services)')).toBeInTheDocument();
    await expect(canvas.getByText('api-gateway')).toBeInTheDocument();
    await expect(canvas.getByText('order-service')).toBeInTheDocument();
  },
};

export const WithLogsAndErrors: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('Service Map (2 services)')).toBeInTheDocument();
    await expect(canvas.getByText(/worker-ser/)).toBeInTheDocument();
  },
};
