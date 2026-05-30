import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import LogsView from './LogsView.svelte';
import {
  updateWidgetData,
  clearAllData,
  setPaused,
  pendingLogsSignal,
} from '../store.svelte';
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
    setPaused(false);
  },
} satisfies Meta<typeof LogsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/No logs yet\. Send logs via AutotelLogExporter/),
    ).toBeInTheDocument();
  },
};

export const SingleLog: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      logs: [makeLog({ body: 'Application started successfully' })],
    });
    await expect(
      await canvas.findByText('Application started successfully'),
    ).toBeInTheDocument();
    await expect(canvas.getByText('Logs (1)')).toBeInTheDocument();
  },
};

export const MultipleLogs: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('Connecting to database')).toBeInTheDocument();
    await expect(canvas.getByText('Cache initialized')).toBeInTheDocument();
    await expect(canvas.getByText('Server listening on port 3000')).toBeInTheDocument();
  },
};

export const WithErrors: Story = {
  play: async ({ canvas }) => {
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
    await expect(
      await canvas.findByText('Database connection failed'),
    ).toBeInTheDocument();
    await expect(canvas.getByText('Retry attempt 1')).toBeInTheDocument();
  },
};

export const WithTraceLink: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('Processing request')).toBeInTheDocument();
    await expect(canvas.getAllByRole('button', { name: /Go to trace/i })).toHaveLength(2);
  },
};

export const DifferentSeverities: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('Debug message')).toBeInTheDocument();
    await expect(canvas.getByText('ERROR')).toBeInTheDocument();
    await expect(canvas.getByText('WARN')).toBeInTheDocument();
  },
};

export const MultipleResources: Story = {
  play: async ({ canvas }) => {
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
    await expect(await canvas.findByText('API server started')).toBeInTheDocument();
    await expect(canvas.getByText('Worker initialized')).toBeInTheDocument();
    await expect(canvas.getByText('Job processed')).toBeInTheDocument();
  },
};

export const PausedWithBuffer: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      logs: [
        makeLog({ id: 'shown-1', body: 'Application ready', severityText: 'INFO' }),
      ],
    });
    setPaused(true);
    pendingLogsSignal.value = [
      makeLog({
        id: 'pending-1',
        body: 'Slow query detected (warn)',
        severityText: 'WARN',
        severityNumber: 13,
      }),
      makeLog({
        id: 'pending-2',
        body: 'Cache miss',
        severityText: 'INFO',
      }),
      makeLog({
        id: 'pending-3',
        body: 'Connection refused',
        severityText: 'ERROR',
        severityNumber: 17,
      }),
      makeLog({
        id: 'pending-4',
        body: 'Retrying request',
        severityText: 'INFO',
      }),
    ];
    await expect(await canvas.findByText('Resume (+4)')).toBeInTheDocument();
    await expect(canvas.getByText('Application ready')).toBeInTheDocument();
  },
};
