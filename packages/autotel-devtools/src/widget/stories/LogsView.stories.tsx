import { h } from 'preact';
import type { Meta, StoryObj } from '@storybook/preact-vite';
import { LogsView } from '../components/LogsView';
import { updateWidgetData, clearAllData } from '../store';
import type { LogData } from '../types';

function makeLog(overrides: Partial<LogData> = {}): LogData {
  return {
    id:
      overrides.id ??
      `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    body: overrides.body ?? 'Test log message',
    timestamp: overrides.timestamp ?? Date.now(),
    severityText: overrides.severityText ?? 'INFO',
    severityNumber: overrides.severityNumber ?? 9,
    traceId: overrides.traceId,
    spanId: overrides.spanId,
    resourceName: overrides.resourceName ?? 'test-service',
    attributes: overrides.attributes,
    resource: overrides.resource,
  };
}

const meta = {
  title: 'Views/LogsView',
  component: LogsView,
  parameters: {
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
  },
} satisfies Meta<typeof LogsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const SingleLog: Story = {
  play: async () => {
    updateWidgetData({
      logs: [makeLog({ body: 'Application started successfully' })],
    });
  },
};

export const MultipleLogs: Story = {
  play: async () => {
    const now = Date.now();
    updateWidgetData({
      logs: [
        makeLog({
          id: 'log-1',
          body: 'Connecting to database',
          severityText: 'INFO',
          timestamp: now - 3000,
        }),
        makeLog({
          id: 'log-2',
          body: 'Cache initialized',
          severityText: 'DEBUG',
          timestamp: now - 2000,
        }),
        makeLog({
          id: 'log-3',
          body: 'Server listening on port 3000',
          severityText: 'INFO',
          timestamp: now - 1000,
        }),
      ],
    });
  },
};

export const WithErrors: Story = {
  play: async () => {
    const now = Date.now();
    updateWidgetData({
      logs: [
        makeLog({
          id: 'log-1',
          body: 'Starting request processing',
          severityText: 'INFO',
          timestamp: now - 3000,
        }),
        makeLog({
          id: 'log-2',
          body: 'Database connection failed',
          severityText: 'ERROR',
          severityNumber: 17,
          timestamp: now - 2000,
        }),
        makeLog({
          id: 'log-3',
          body: 'Retry attempt 1',
          severityText: 'WARN',
          severityNumber: 13,
          timestamp: now - 1800,
        }),
        makeLog({
          id: 'log-4',
          body: 'Connection restored',
          severityText: 'INFO',
          timestamp: now - 1000,
        }),
      ],
    });
  },
};

export const WithTraceLink: Story = {
  play: async () => {
    const now = Date.now();
    updateWidgetData({
      logs: [
        makeLog({
          id: 'log-1',
          body: 'Processing request',
          severityText: 'INFO',
          traceId: 'trace-123',
          spanId: 'span-456',
          timestamp: now - 2000,
        }),
        makeLog({
          id: 'log-2',
          body: 'Request completed',
          severityText: 'INFO',
          traceId: 'trace-123',
          timestamp: now - 1000,
        }),
      ],
    });
  },
};

export const DifferentSeverities: Story = {
  play: async () => {
    const now = Date.now();
    updateWidgetData({
      logs: [
        makeLog({
          id: 'log-1',
          body: 'Debug message',
          severityText: 'DEBUG',
          severityNumber: 5,
          timestamp: now - 5000,
        }),
        makeLog({
          id: 'log-2',
          body: 'Info message',
          severityText: 'INFO',
          severityNumber: 9,
          timestamp: now - 4000,
        }),
        makeLog({
          id: 'log-3',
          body: 'Warning message',
          severityText: 'WARN',
          severityNumber: 13,
          timestamp: now - 3000,
        }),
        makeLog({
          id: 'log-4',
          body: 'Error message',
          severityText: 'ERROR',
          severityNumber: 17,
          timestamp: now - 2000,
        }),
      ],
    });
  },
};

export const MultipleResources: Story = {
  play: async () => {
    const now = Date.now();
    updateWidgetData({
      logs: [
        makeLog({
          id: 'log-1',
          body: 'API server started',
          resourceName: 'api-service',
          timestamp: now - 4000,
        }),
        makeLog({
          id: 'log-2',
          body: 'Worker initialized',
          resourceName: 'worker-service',
          timestamp: now - 3000,
        }),
        makeLog({
          id: 'log-3',
          body: 'Cache hit',
          resourceName: 'api-service',
          timestamp: now - 2000,
        }),
        makeLog({
          id: 'log-4',
          body: 'Job processed',
          resourceName: 'worker-service',
          timestamp: now - 1000,
        }),
      ],
    });
  },
};
