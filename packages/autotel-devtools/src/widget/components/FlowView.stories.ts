import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent } from 'storybook/test'
import FlowView from './FlowView.svelte'
import { tracesSignal } from '../store.svelte'
import type { SpanData, TraceData } from '../types'
import financialCalculator from '../flow/__fixtures__/financial-calculator.json'

// FlowView takes no props — it derives the graph from `tracesSignal` (per
// trace). Each story seeds the signal in `beforeEach` and clears it after.
function seedTrace(spans: SpanData[], service = 'ai-otel-demos'): () => void {
  const sorted = [...spans].sort((a, b) => a.startTime - b.startTime)
  const trace: TraceData = {
    traceId: sorted[0]?.traceId ?? 'flow-fixture',
    correlationId: sorted[0]?.traceId ?? 'flow-fixture',
    rootSpan: sorted.find((s) => !s.parentSpanId) ?? sorted[0],
    spans: sorted,
    startTime: sorted[0]?.startTime ?? 0,
    endTime: sorted[sorted.length - 1]?.endTime ?? 0,
    duration: 0,
    status: 'OK',
    service,
  }
  tracesSignal.value = [trace]
  return () => {
    tracesSignal.value = []
  }
}

const meta = {
  title: 'Flow/Call graph',
  component: FlowView,
} satisfies Meta<typeof FlowView>
export default meta
type Story = StoryObj<typeof meta>

// The financial-calculator demo: entry → two plain functions → streamText →
// repeated doStream/tool-call loop, with calculate collapsed to one node (5
// calls, 1 errored), plus compare + formatCurrency.
export const FinancialCalculator: Story = {
  beforeEach: () =>
    seedTrace(financialCalculator as unknown as SpanData[]),
  play: async ({ canvas }) => {
    // Bookends present.
    await expect(await canvas.findByText('__start__')).toBeInTheDocument()
    await expect(canvas.getByText('__end__')).toBeInTheDocument()
    // AI tool calls.
    await expect(canvas.getByText('calculate')).toBeInTheDocument()
    await expect(canvas.getByText('formatCurrency')).toBeInTheDocument()
    // Plain (non-AI) functions surfaced alongside tools.
    await expect(canvas.getByText('loadPortfolio')).toBeInTheDocument()
    await expect(canvas.getByText('validateScenario')).toBeInTheDocument()
    // Collapsed count badge for the 5 calculate calls (1 errored → 4/5).
    await expect(canvas.getByText('4/5')).toBeInTheDocument()
    // Per-trace LLM token total in the header (ollama is unpriced, so tokens
    // only; the outer streamText aggregate is counted once, not double-counted
    // with its doStream children).
    await expect(canvas.getByText('12672→1177')).toBeInTheDocument()

    // Clicking a node opens the I/O detail panel.
    await userEvent.click(canvas.getByText('calculate'))
    await expect(await canvas.findByText('Input')).toBeInTheDocument()
    await expect(canvas.getByText('Output')).toBeInTheDocument()
    // ...with a deep-link button into the Traces waterfall.
    await expect(
      canvas.getByRole('button', { name: /Traces/i }),
    ).toBeInTheDocument()
  },
}

// A plain function node shows its captured autotel.input/output.
export const FunctionIO: Story = {
  beforeEach: () =>
    seedTrace(financialCalculator as unknown as SpanData[]),
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByText('loadPortfolio'))
    await expect(await canvas.findByText('Input')).toBeInTheDocument()
    await expect(canvas.getByText(/holdings/)).toBeInTheDocument()
  },
}
