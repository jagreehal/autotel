import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import TraceLogs from './TraceLogs.svelte';
import type { LogData, SpanData, TraceData } from '../types';

const root: SpanData = {
  traceId: 'f3a1c2d4e5b6a7c8d9e0f1a2b3c4d5e6',
  spanId: 'aaaaaaaaaaaaaaaa',
  name: 'atm.withdraw',
  kind: 'INTERNAL',
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_000_090,
  duration: 90,
  attributes: {},
  status: { code: 'OK' },
};

const debit: SpanData = {
  ...root,
  spanId: 'bbbbbbbbbbbbbbbb',
  parentSpanId: root.spanId,
  name: 'bank.debit',
  startTime: 1_700_000_000_040,
  duration: 45,
};

const trace: TraceData = {
  traceId: root.traceId,
  correlationId: root.traceId.slice(0, 16),
  rootSpan: root,
  spans: [root, debit],
  startTime: root.startTime,
  endTime: root.endTime,
  duration: root.duration,
  status: 'OK',
  service: 'atm',
};

const logs: LogData[] = [
  ['withdrawal started', 0, root],
  ['user found', 15, root],
  ['pin ok', 21, root],
  ['debited', 85, debit],
].map(([body, offset, span], i) => ({
  id: `log-${i}`,
  traceId: trace.traceId,
  spanId: (span as SpanData).spanId,
  severityText: 'INFO',
  body: body as string,
  timestamp: root.startTime + (offset as number),
}));

const meta = {
  title: 'Components/TraceLogs',
  component: TraceLogs,
  parameters: { layout: 'fullscreen' },
  args: { trace, onSpanSelect: () => {} },
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) =>
      String(url).endsWith('/api/query/logs')
        ? new Response(JSON.stringify({ logs, nextCursor: null }))
        : original(url, init)) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  },
} satisfies Meta<typeof TraceLogs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneWithdrawal: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Logs (4)')).toBeInTheDocument();
    await expect(canvas.getByText('bank.debit')).toBeInTheDocument();
  },
};

export const SelectedSpan: Story = {
  args: { selectedSpanId: debit.spanId },
};
