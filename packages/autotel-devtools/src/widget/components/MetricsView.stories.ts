import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import MetricsView from './MetricsView.svelte';
import { updateWidgetData, clearAllData } from '../store.svelte';
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

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/No metrics yet/)).toBeInTheDocument();
  },
};

export const SingleEvent: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      metrics: [
        makeMetric({
          type: 'event',
          name: 'user.signup',
          attributes: { userId: '123' },
        }),
      ],
    });
    await expect(await canvas.findByText('user.signup')).toBeInTheDocument();
    await expect(canvas.getByText('Events (1)')).toBeInTheDocument();
  },
};

export const MultipleEvents: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('user.signup')).toBeInTheDocument();
    await expect(canvas.getByText('user.login')).toBeInTheDocument();
    await expect(canvas.getByText('user.logout')).toBeInTheDocument();
  },
};

export const DifferentTypes: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('Events (1)')).toBeInTheDocument();
    await expect(canvas.getByText('Funnels (1)')).toBeInTheDocument();
    await expect(canvas.getByText('Outcomes (1)')).toBeInTheDocument();
    await expect(canvas.getByText('Values (1)')).toBeInTheDocument();
  },
};

export const WithAttributes: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('method: GET')).toBeInTheDocument();
    await expect(canvas.getByText('path: /api/orders')).toBeInTheDocument();
  },
};

export const WithTraceLink: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('db.query')).toBeInTheDocument();
    await expect(canvas.getByText('query: SELECT * FROM users')).toBeInTheDocument();
  },
};

export const ManyMetrics: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('metric.0')).toBeInTheDocument();
    await expect(canvas.getByText('Events (20)')).toBeInTheDocument();
    await expect(canvas.getByText('+10 more')).toBeInTheDocument();
  },
};
