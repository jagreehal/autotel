import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';
import ResourcesView from './ResourcesView.svelte';
import { updateWidgetData, clearAllData } from '../store.svelte';
import type { SpanData, TraceData } from '../types';

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  const traceId = overrides.traceId ?? 'trace-1';
  const start = overrides.startTime ?? Date.now();
  return {
    traceId,
    spanId: overrides.spanId ?? 'span-1',
    name: overrides.name ?? 'GET /api',
    kind: overrides.kind ?? 'SERVER',
    startTime: start,
    endTime: overrides.endTime ?? start + 20,
    duration: overrides.duration ?? 20,
    attributes: overrides.attributes ?? {},
    status: overrides.status ?? { code: 'OK' },
    events: overrides.events ?? [],
    parentSpanId: overrides.parentSpanId,
  };
}

// A trace whose spans carry the resource-identifying attributes
// (`service.name`, `db.system`, …) that ResourcesView derives summaries from.
function makeTrace(
  traceId: string,
  service: string,
  spans: SpanData[],
): TraceData {
  const withTrace = spans.map((s) => ({ ...s, traceId }));
  return {
    traceId,
    correlationId: traceId,
    rootSpan: withTrace[0],
    spans: withTrace,
    startTime: withTrace[0].startTime,
    endTime: withTrace[withTrace.length - 1].endTime,
    duration: 100,
    status: withTrace.some((s) => s.status.code === 'ERROR') ? 'ERROR' : 'OK',
    service,
  };
}

const meta = {
  title: 'Views/ResourcesView',
  component: ResourcesView,
  parameters: {
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
  },
} satisfies Meta<typeof ResourcesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/No resources derived yet/),
    ).toBeInTheDocument();
    await expect(canvas.getByText('Resources (0)')).toBeInTheDocument();
  },
};

// A healthy service, a database (inferred from `db.system`), and an
// unhealthy service (1 of 2 spans errored → 50% error rate).
export const MultipleResources: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      traces: [
        makeTrace('t-1', 'checkout-api', [
          makeSpan({
            spanId: 's1',
            name: 'POST /checkout',
            attributes: { 'service.name': 'checkout-api' },
          }),
        ]),
        makeTrace('t-2', 'orders-api', [
          makeSpan({
            spanId: 's2',
            name: 'SELECT orders',
            kind: 'CLIENT',
            attributes: { 'db.system': 'postgresql' },
          }),
        ]),
        makeTrace('t-3', 'payments-api', [
          makeSpan({
            spanId: 's3',
            name: 'POST /charge',
            attributes: { 'service.name': 'payments-api' },
          }),
          makeSpan({
            spanId: 's4',
            name: 'POST /charge retry',
            attributes: { 'service.name': 'payments-api' },
            status: { code: 'ERROR' },
          }),
        ]),
      ],
    });

    await expect(
      await canvas.findByText('checkout-api'),
    ).toBeInTheDocument();
    await expect(canvas.getByText('postgresql')).toBeInTheDocument();
    await expect(canvas.getByText('payments-api')).toBeInTheDocument();
    await expect(canvas.getByText('Resources (3)')).toBeInTheDocument();

    // Type is derived from attributes (db.system → database) and shown on the
    // resource's own row — scope to it so we don't match the type-filter option.
    const dbRow = canvas.getByText('postgresql').closest('.border');
    await expect(dbRow).not.toBeNull();
    await expect(within(dbRow as HTMLElement).getByText('database')).toBeInTheDocument();
    // payments-api: 1 of 2 spans errored → unhealthy.
    await expect(canvas.getByText('unhealthy')).toBeInTheDocument();
  },
};

export const FilterByName: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({
      traces: [
        makeTrace('t-1', 'checkout-api', [
          makeSpan({
            spanId: 's1',
            attributes: { 'service.name': 'checkout-api' },
          }),
        ]),
        makeTrace('t-2', 'inventory-api', [
          makeSpan({
            spanId: 's2',
            attributes: { 'service.name': 'inventory-api' },
          }),
        ]),
      ],
    });

    await expect(await canvas.findByText('checkout-api')).toBeInTheDocument();
    await expect(canvas.getByText('inventory-api')).toBeInTheDocument();

    await userEvent.type(
      canvas.getByPlaceholderText('Filter resources'),
      'checkout',
    );

    await expect(canvas.getByText('checkout-api')).toBeInTheDocument();
    await expect(canvas.queryByText('inventory-api')).not.toBeInTheDocument();
  },
};
