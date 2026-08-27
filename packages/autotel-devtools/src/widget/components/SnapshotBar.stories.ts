import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent } from 'storybook/test';
import SnapshotBar from './SnapshotBar.svelte';
import {
  clearAllData,
  loadSnapshot,
  updateWidgetData,
  exitSnapshotMode,
  tracesSignal,
} from '../store.svelte';
import type { TraceData } from '../types';

function makeTrace(id: string, status: 'OK' | 'ERROR' = 'OK'): TraceData {
  const now = Date.now();
  const span = {
    traceId: id,
    spanId: `${id}-root`,
    name: 'root',
    kind: 'INTERNAL' as const,
    startTime: now,
    endTime: now + 50,
    duration: 50,
    attributes: {},
    status: { code: status },
  };
  return {
    traceId: id,
    correlationId: id,
    rootSpan: span,
    spans: [span],
    startTime: now,
    endTime: now + 50,
    duration: 50,
    status,
    service: 'demo',
  };
}

const meta = {
  title: 'Views/SnapshotBar',
  component: SnapshotBar,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    exitSnapshotMode();
    clearAllData();
  },
} satisfies Meta<typeof SnapshotBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LiveEmpty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Download snapshot')).toBeInTheDocument();
    await expect(canvas.getByText('Load snapshot')).toBeInTheDocument();
    await expect(canvas.getByText('No data captured')).toBeInTheDocument();
    // Nothing to put in a file, so the button says so rather than producing
    // an empty one.
    await expect(
      canvas.getByRole('button', { name: /Download snapshot/i }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole('button', { name: /Clear/i }),
    ).toBeInTheDocument();
  },
};

export const ClearsData: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({ traces: [makeTrace('t1'), makeTrace('t2', 'ERROR')] });
    await expect(tracesSignal.value).toHaveLength(2);

    await userEvent.click(canvas.getByRole('button', { name: /Clear/i }));

    await expect(tracesSignal.value).toHaveLength(0);
  },
};

export const LiveWithData: Story = {
  play: async ({ canvas }) => {
    updateWidgetData({ traces: [makeTrace('t1'), makeTrace('t2', 'ERROR')] });
    // The point of this story against `LiveEmpty`. Until the bar reported its
    // contents the two rendered identically, so the name promised a state the
    // component could not show.
    await expect(await canvas.findByText(/2 traces/)).toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: /Download snapshot/i }),
    ).toBeEnabled();
    await expect(canvas.queryByText('Snapshot mode')).not.toBeInTheDocument();
  },
};

export const SnapshotMode: Story = {
  play: async ({ canvas }) => {
    loadSnapshot({
      traces: [makeTrace('s1'), makeTrace('s2', 'ERROR')],
      logs: [],
      errors: [],
    });
    await expect(await canvas.findByText('Snapshot mode')).toBeInTheDocument();
    await expect(canvas.getByText(/live updates paused/)).toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: /Exit/i }),
    ).toBeInTheDocument();
  },
};
