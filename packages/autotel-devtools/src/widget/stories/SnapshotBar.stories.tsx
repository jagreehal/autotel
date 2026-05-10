import { h } from 'preact'
import type { Meta, StoryObj } from '@storybook/preact-vite'
import { SnapshotBar } from '../components/SnapshotBar'
import {
  clearAllData,
  loadSnapshot,
  updateWidgetData,
  exitSnapshotMode,
} from '../store'
import type { TraceData } from '../types'

function makeTrace(id: string, status: 'OK' | 'ERROR' = 'OK'): TraceData {
  const now = Date.now()
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
  }
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
  }
}

const meta = {
  title: 'Views/SnapshotBar',
  component: SnapshotBar,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    exitSnapshotMode()
    clearAllData()
  },
} satisfies Meta<typeof SnapshotBar>

export default meta
type Story = StoryObj<typeof meta>

export const LiveEmpty: Story = {}

export const LiveWithData: Story = {
  play: async () => {
    updateWidgetData({ traces: [makeTrace('t1'), makeTrace('t2', 'ERROR')] })
  },
}

export const SnapshotMode: Story = {
  play: async () => {
    loadSnapshot({
      traces: [makeTrace('s1'), makeTrace('s2', 'ERROR')],
      logs: [],
      errors: [],
      metrics: [],
    })
  },
}
