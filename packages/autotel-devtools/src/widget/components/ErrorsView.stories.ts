import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import ErrorsView from './ErrorsView.svelte';
import { errorGroupsSignal, clearAllData } from '../store.svelte';
import type { ErrorGroup } from '../types';

function makeErrorGroup(overrides: Partial<ErrorGroup> = {}): ErrorGroup {
  return {
    fingerprint:
      overrides.fingerprint ??
      `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: overrides.type ?? 'Error',
    message: overrides.message ?? 'Something went wrong',
    stackTrace: overrides.stackTrace,
    count: overrides.count ?? 1,
    firstSeen: overrides.firstSeen ?? Date.now() - 5000,
    lastSeen: overrides.lastSeen ?? Date.now(),
    affectedTraces: overrides.affectedTraces ?? [],
    affectedSpans: overrides.affectedSpans ?? [],
    service: overrides.service,
    attributes: overrides.attributes,
  };
}

const meta = {
  title: 'Views/ErrorsView',
  component: ErrorsView,
  parameters: {
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
  },
} satisfies Meta<typeof ErrorsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No errors captured')).toBeInTheDocument();
  },
};

export const SingleError: Story = {
  play: async ({ canvas }) => {
    errorGroupsSignal.value = [
      makeErrorGroup({
        type: 'TypeError',
        message: "Cannot read property 'id' of undefined",
        count: 1,
      }),
    ];
    await expect(await canvas.findByText('TypeError')).toBeInTheDocument();
    await expect(
      canvas.getByText("Cannot read property 'id' of undefined"),
    ).toBeInTheDocument();
  },
};

export const MultipleErrors: Story = {
  play: async ({ canvas }) => {
    const now = Date.now();
    errorGroupsSignal.value = [
      makeErrorGroup({
        type: 'TypeError',
        message: "Cannot read property 'id' of undefined",
        count: 5,
        firstSeen: now - 10000,
        lastSeen: now - 1000,
      }),
      makeErrorGroup({
        type: 'NetworkError',
        message: 'Failed to fetch',
        count: 3,
        firstSeen: now - 8000,
        lastSeen: now - 2000,
      }),
      makeErrorGroup({
        type: 'ValidationError',
        message: 'Invalid email format',
        count: 2,
        firstSeen: now - 5000,
        lastSeen: now - 3000,
      }),
    ];
    await expect(await canvas.findByText('NetworkError')).toBeInTheDocument();
    await expect(canvas.getByText('ValidationError')).toBeInTheDocument();
    await expect(canvas.getByText('Groups:')).toBeInTheDocument();
  },
};

export const WithStackTrace: Story = {
  play: async ({ canvas, userEvent }) => {
    errorGroupsSignal.value = [
      makeErrorGroup({
        type: 'Error',
        message: 'Unexpected token in JSON',
        stackTrace: `SyntaxError: Unexpected token < in JSON at position 0
    at JSON.parse (<anonymous>)
    at fetchUsers (app.js:42:15)
    at async loadPage (app.js:156:20)`,
        count: 10,
      }),
    ];
    const row = await canvas.findByText('Unexpected token in JSON');
    await userEvent.click(row);
    await expect(await canvas.findByText('Stack Trace')).toBeInTheDocument();
    await expect(canvas.getByText(/JSON\.parse/)).toBeInTheDocument();
  },
};

export const WithService: Story = {
  play: async ({ canvas }) => {
    const now = Date.now();
    errorGroupsSignal.value = [
      makeErrorGroup({
        type: 'DatabaseError',
        message: 'Connection timeout',
        service: 'api-service',
        count: 15,
        firstSeen: now - 30000,
        lastSeen: now - 1000,
      }),
      makeErrorGroup({
        type: 'CacheError',
        message: 'Redis connection refused',
        service: 'cache-service',
        count: 8,
        firstSeen: now - 25000,
        lastSeen: now - 2000,
      }),
    ];
    await expect(await canvas.findByText('api-service')).toBeInTheDocument();
    await expect(canvas.getByText('cache-service')).toBeInTheDocument();
  },
};

export const WithAffectedTraces: Story = {
  play: async ({ canvas, userEvent }) => {
    const now = Date.now();
    errorGroupsSignal.value = [
      makeErrorGroup({
        type: 'Error',
        message: 'Request failed with status 500',
        count: 50,
        affectedTraces: ['trace-1', 'trace-2', 'trace-3', 'trace-4', 'trace-5'],
        affectedSpans: ['GET /api/users', 'GET /api/orders'],
        firstSeen: now - 60000,
        lastSeen: now - 100,
      }),
    ];
    await userEvent.click(await canvas.findByText('Request failed with status 500'));
    await expect(await canvas.findByText('Recent Traces')).toBeInTheDocument();
    await expect(canvas.getByText('GET /api/users')).toBeInTheDocument();
  },
};

export const HighFrequencyError: Story = {
  play: async ({ canvas }) => {
    const now = Date.now();
    errorGroupsSignal.value = [
      makeErrorGroup({
        type: 'RateLimitError',
        message: 'Too many requests',
        count: 500,
        firstSeen: now - 60000,
        lastSeen: now - 100,
        service: 'api-gateway',
      }),
    ];
    await expect(await canvas.findByText('500x')).toBeInTheDocument();
    await expect(canvas.getByText('api-gateway')).toBeInTheDocument();
  },
};

export const DifferentErrorTypes: Story = {
  play: async ({ canvas }) => {
    errorGroupsSignal.value = [
      makeErrorGroup({
        type: 'TypeError',
        message: "Cannot read property 'map' of undefined",
        count: 20,
      }),
      makeErrorGroup({
        type: 'ReferenceError',
        message: 'process is not defined',
        count: 15,
      }),
      makeErrorGroup({
        type: 'SyntaxError',
        message: 'Unexpected token }',
        count: 10,
      }),
      makeErrorGroup({
        type: 'RangeError',
        message: 'Maximum call stack size exceeded',
        count: 5,
      }),
      makeErrorGroup({
        type: 'URIError',
        message: 'URI malformed',
        count: 2,
      }),
    ];
    await expect(await canvas.findByText('ReferenceError')).toBeInTheDocument();
    await expect(canvas.getByText('URIError')).toBeInTheDocument();
    await expect(canvas.getByText('Total:')).toBeInTheDocument();
  },
};
