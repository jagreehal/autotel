import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect } from 'storybook/test';
import Panel from './Panel.svelte';
import {
  updateWidgetData,
  clearAllData,
  setPaused,
  setSelectedTrace,
  widgetExpandedSignal,
  widgetDockedSignal,
  panelSizeSignal,
} from '../store.svelte';
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
    service: overrides.service ?? 'money-transfer',
  };
}

function seedTraces() {
  const now = Date.now();
  updateWidgetData({
    traces: [
      makeTrace({
        traceId: 'trace-1',
        duration: 12,
        startTime: now - 1000,
        rootSpan: makeSpan({ name: 'GET /', duration: 12, startTime: now - 1000 }),
      }),
      makeTrace({
        traceId: 'trace-2',
        duration: 118,
        startTime: now - 2000,
        rootSpan: makeSpan({
          name: 'POST /transfer',
          duration: 118,
          startTime: now - 2000,
        }),
      }),
    ],
  });
}

const meta = {
  title: 'Surfaces/Panel (Docked)',
  component: Panel,
  parameters: {
    // The panel is a fixed, edge-docked surface — render it over the full
    // viewport so the dock geometry is visible.
    layout: 'fullscreen',
  },
  beforeEach: () => {
    clearAllData();
    setPaused(false);
    setSelectedTrace(null);
    widgetExpandedSignal.value = true;
    widgetDockedSignal.value = 'bottom';
    panelSizeSignal.value = { vertical: 440, horizontal: 560 };
  },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default: docked to the bottom edge, full width, host page stays interactive. */
export const BottomDock: Story = {
  play: async ({ canvas }) => {
    seedTraces();
    await expect(await canvas.findByText('autotel')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Traces' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Close devtools' })).toBeInTheDocument();
    // No modal backdrop should exist.
    await expect(canvas.queryByLabelText('Close panel')).not.toBeInTheDocument();
  },
};

/** Docked to the right edge as a vertical sidebar. */
export const RightDock: Story = {
  beforeEach: () => {
    widgetDockedSignal.value = 'right';
  },
  play: async ({ canvas }) => {
    seedTraces();
    await expect(await canvas.findByText('autotel')).toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: 'Change dock position' }),
    ).toBeInTheDocument();
  },
};

/** Docked to the left edge. */
export const LeftDock: Story = {
  beforeEach: () => {
    widgetDockedSignal.value = 'left';
  },
  play: async ({ canvas }) => {
    seedTraces();
    await expect(await canvas.findByText('autotel')).toBeInTheDocument();
  },
};

/**
 * Selecting a trace renders the detail *inside* the panel — the panel keeps its
 * size and never jumps dimensions (regression guard for the old resize-on-open
 * behavior).
 */
export const TraceSelectedKeepsSize: Story = {
  play: async ({ canvas, userEvent }) => {
    seedTraces();
    const sizeBefore = { ...panelSizeSignal.value };
    await userEvent.click(await canvas.findByText('GET /'));
    await expect(await canvas.findByText('Back to traces')).toBeInTheDocument();
    expect(panelSizeSignal.value).toEqual(sizeBefore);
  },
};

/** Cycling the dock control moves bottom → right → left. */
export const CycleDock: Story = {
  play: async ({ canvas, userEvent }) => {
    seedTraces();
    expect(widgetDockedSignal.value).toBe('bottom');
    const dockBtn = canvas.getByRole('button', { name: 'Change dock position' });
    await userEvent.click(dockBtn);
    expect(widgetDockedSignal.value).toBe('right');
    await userEvent.click(dockBtn);
    expect(widgetDockedSignal.value).toBe('left');
    await userEvent.click(dockBtn);
    expect(widgetDockedSignal.value).toBe('bottom');
  },
};

/** Dark theme snapshot. */
export const Dark: Story = {
  globals: { theme: 'dark' },
  play: async ({ canvas }) => {
    seedTraces();
    await expect(await canvas.findByText('autotel')).toBeInTheDocument();
  },
};
