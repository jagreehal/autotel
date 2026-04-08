import { h } from 'preact';
import type { Meta, StoryObj } from '@storybook/preact-vite';
import { MetricsView } from '../components/MetricsView';
import { updateWidgetData, clearAllData } from '../store';
import type { MetricData } from '../types';

function makeMetric(overrides: Partial<MetricData> = {}): MetricData {
  return {
    type: overrides.type ?? 'event',
    name: overrides.name ?? 'user.signup',
    value: overrides.value,
    attributes: overrides.attributes ?? {},
    timestamp: overrides.timestamp ?? Date.now(),
    traceId: overrides.traceId,
  };
}

const meta = {
  title: 'Views/MetricsView',
  component: MetricsView,
  parameters: {
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
  },
} satisfies Meta<typeof MetricsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const SingleEvent: Story = {
  play: async () => {
    updateWidgetData({
      metrics: [
        makeMetric({
          type: 'event',
          name: 'user.signup',
          attributes: { userId: '123' },
        }),
      ],
    });
  },
};

export const MultipleEvents: Story = {
  play: async () => {
    const now = Date.now();
    updateWidgetData({
      metrics: [
        makeMetric({
          type: 'event',
          name: 'user.signup',
          timestamp: now - 3000,
        }),
        makeMetric({
          type: 'event',
          name: 'user.login',
          timestamp: now - 2000,
        }),
        makeMetric({
          type: 'event',
          name: 'user.logout',
          timestamp: now - 1000,
        }),
      ],
    });
  },
};

export const DifferentTypes: Story = {
  play: async () => {
    const now = Date.now();
    updateWidgetData({
      metrics: [
        makeMetric({
          type: 'event',
          name: 'page.view',
          attributes: { path: '/home' },
          timestamp: now - 5000,
        }),
        makeMetric({
          type: 'funnel',
          name: 'checkout',
          value: 42,
          timestamp: now - 4000,
        }),
        makeMetric({
          type: 'outcome',
          name: 'payment.success',
          value: 99.5,
          timestamp: now - 3000,
        }),
        makeMetric({
          type: 'value',
          name: 'latency',
          value: 234,
          attributes: { unit: 'ms' },
          timestamp: now - 2000,
        }),
      ],
    });
  },
};

export const WithAttributes: Story = {
  play: async () => {
    updateWidgetData({
      metrics: [
        makeMetric({
          type: 'event',
          name: 'api.request',
          attributes: {
            method: 'GET',
            path: '/api/users',
            statusCode: 200,
            duration: 45,
          },
        }),
        makeMetric({
          type: 'event',
          name: 'api.request',
          attributes: {
            method: 'POST',
            path: '/api/orders',
            statusCode: 201,
            duration: 123,
          },
        }),
      ],
    });
  },
};

export const WithTraceLink: Story = {
  play: async () => {
    updateWidgetData({
      metrics: [
        makeMetric({
          type: 'event',
          name: 'db.query',
          attributes: { query: 'SELECT * FROM users' },
          traceId: 'trace-123',
        }),
      ],
    });
  },
};

export const ManyMetrics: Story = {
  play: async () => {
    const now = Date.now();
    const metrics = Array.from({ length: 20 }, (_, i) =>
      makeMetric({
        type: 'event',
        name: `metric.${i}`,
        value: Math.random() * 100,
        timestamp: now - i * 100,
      }),
    );
    updateWidgetData({ metrics });
  },
};
