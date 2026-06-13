import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent } from 'storybook/test'
import GenAiView from './GenAiView.svelte'
import { tracesSignal } from '../store.svelte'
import type { SpanData, TraceData } from '../types'
import openaiChat from '../genai/__fixtures__/openai-v2-chat.json'
import anthropicCache from '../genai/__fixtures__/anthropic-cache.json'
import openaiAgentsHandoff from '../genai/__fixtures__/openai-agents-handoff.json'
import aisdkOllama from '../genai/__fixtures__/aisdk-ollama-real.json'
import aisdkTools from '../genai/__fixtures__/aisdk-ollama-tools-real.json'
import pydanticAi from '../genai/__fixtures__/pydantic-ai-ollama-real.json'
import gemini from '../genai/__fixtures__/gemini-pydantic-real.json'
import langchain from '../genai/__fixtures__/langchain-ollama-real.json'

// `GenAiView.svelte` takes no props — it derives its rows from `tracesSignal`
// (via the `genAiRowsSignal` computed). The Preact stories passed a `raw` span
// arg into a local `ComponentPair`/`GenAiViewHarness` helper; those helpers do
// not exist in the Svelte port. Each story now seeds `tracesSignal` from its
// fixtures in `beforeEach` and tears it down afterwards. The play() assertions
// are unchanged — `GenAiView` renders the list + selected span header/panel, so
// the same text is on screen.

function seedTraces(fixtures: SpanData[][]): () => void {
  const traces: TraceData[] = fixtures.map((spans, i) => ({
    traceId: `fixture-${i}`,
    correlationId: `fixture-${i}`,
    rootSpan: spans[0],
    spans,
    startTime: spans[0]?.startTime ?? 0,
    endTime: spans[spans.length - 1]?.endTime ?? 0,
    duration: 0,
    status: 'OK',
    service: `fixture-service-${i}`,
  }))
  tracesSignal.value = traces
  return () => {
    tracesSignal.value = []
  }
}

const meta = {
  title: 'GenAI/Single span',
  component: GenAiView,
} satisfies Meta<typeof GenAiView>
export default meta
type Story = StoryObj<typeof meta>

export const OpenAiChat: Story = {
  beforeEach: () => seedTraces([[openaiChat as unknown as SpanData]]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('openai')).toBeInTheDocument()
    await expect(
      canvas.getAllByText('gpt-4o-mini-2024-07-18').length,
    ).toBeGreaterThan(0)
    await expect(canvas.getByText('This is a test.')).toBeInTheDocument()
  },
}

export const AnthropicCacheHit: Story = {
  beforeEach: () => seedTraces([[anthropicCache as unknown as SpanData]]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('anthropic')).toBeInTheDocument()
    // ModelHeader spells out the cached token share inline, e.g. "176 (100 cached)".
    await expect(canvas.getByText(/\(\d+ cached\)/)).toBeInTheDocument()
  },
}

export const OpenAiAgentsHandoff: Story = {
  beforeEach: () => seedTraces([[openaiAgentsHandoff as unknown as SpanData]]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Agent handoff')).toBeInTheDocument()
    await expect(canvas.getAllByText('Triage Agent').length).toBeGreaterThan(0)
    await expect(canvas.getByText('Refunds Specialist')).toBeInTheDocument()
  },
}

export const VercelAiSdkOllamaReal: Story = {
  beforeEach: () =>
    seedTraces([
      [
        (aisdkOllama as unknown as SpanData[]).find(
          (s) => s.name === 'ai.generateText.doGenerate',
        )!,
      ],
    ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('ollama')).toBeInTheDocument()
    await expect(canvas.getAllByText('granite4.1:3b').length).toBeGreaterThan(
      0,
    )
  },
}

export const PydanticAiLogfireReal: Story = {
  beforeEach: () =>
    seedTraces([
      [(pydanticAi as unknown as SpanData[]).find((s) => s.name.startsWith('chat '))!],
    ]),
  play: async ({ canvas }) => {
    // GenAiView renders the span list + selected detail, so provider/op labels
    // appear in both the row and the header — assert presence via AllByText.
    await expect((await canvas.findAllByText('ollama')).length).toBeGreaterThan(0)
    await expect(canvas.getAllByText('chat').length).toBeGreaterThan(0)
  },
}

export const GeminiPydanticReal: Story = {
  beforeEach: () =>
    seedTraces([
      [(gemini as unknown as SpanData[]).find((s) => s.name.startsWith('chat '))!],
    ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('google')).toBeInTheDocument()
    await expect(canvas.getAllByText(/^gemini-/).length).toBeGreaterThan(0)
  },
}

export const LangChainOllamaReal: Story = {
  beforeEach: () => seedTraces([[(langchain as unknown as SpanData[])[0]]]),
  play: async ({ canvas }) => {
    await expect((await canvas.findAllByText('ollama')).length).toBeGreaterThan(0)
    await expect(canvas.getAllByText('chat').length).toBeGreaterThan(0)
  },
}

export const FullViewAllFixtures: Story = {
  beforeEach: () =>
    seedTraces([
      [openaiChat as unknown as SpanData],
      [anthropicCache as unknown as SpanData],
      [openaiAgentsHandoff as unknown as SpanData],
      aisdkOllama as unknown as SpanData[],
      pydanticAi as unknown as SpanData[],
      aisdkTools as unknown as SpanData[],
      gemini as unknown as SpanData[],
      langchain as unknown as SpanData[],
    ]),
  play: async ({ canvas }) => {
    await expect(
      (await canvas.findAllByText(/openai\/gpt-4o-mini/i)).length,
    ).toBeGreaterThan(0)
    await expect(await canvas.findByText(/anthropic\//)).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /Timeline/i })).toBeInTheDocument()
  },
}

export const VercelAiSdkToolsReal: Story = {
  beforeEach: () => seedTraces([aisdkTools as unknown as SpanData[]]),
  play: async ({ canvas }) => {
    await expect(
      (await canvas.findAllByText(/ollama\/qwen2:latest/i)).length,
    ).toBeGreaterThan(0)
    await expect(await canvas.findByText('Explain run')).toBeInTheDocument()

    const toolName = await canvas.findByText('lookupTraveler')
    await userEvent.click(toolName)
    await expect(await canvas.findByText('Input')).toBeInTheDocument()
  },
}

// Trace mode decomposes the selected run into a depth-indented tree of steps,
// tools and text — switching to it surfaces the tool the model invoked.
export const TraceMode: Story = {
  beforeEach: () => seedTraces([aisdkTools as unknown as SpanData[]]),
  play: async ({ canvas }) => {
    const traceBtn = await canvas.findByRole('button', { name: /^Trace$/i })
    await userEvent.click(traceBtn)
    await expect(
      (await canvas.findAllByText(/Tool: lookupTraveler/i)).length,
    ).toBeGreaterThan(0)
  },
}

// A multi-span run shows the run-summary strip (cost/tokens/tools) and the
// "Explain run" guided tour. The tour
// steps through the run with plain-language narration; here we open it and
// assert the first narrated step renders.
export const RunSummaryAndGuidedTour: Story = {
  beforeEach: () => seedTraces([aisdkTools as unknown as SpanData[]]),
  play: async ({ canvas }) => {
    // Run summary strip appears above the detail for a multi-span run.
    await expect((await canvas.findAllByText('Tokens')).length).toBeGreaterThan(0)
    await expect(canvas.getAllByText('Tools').length).toBeGreaterThan(0)

    // Start the guided tour.
    const explain = await canvas.findByRole('button', { name: /Explain run/i })
    await userEvent.click(explain)

    // The narration banner renders a step counter and exit control.
    await expect(await canvas.findByRole('region', { name: /Guided tour/i })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /Exit tour/i })).toBeInTheDocument()

    // Advance one step.
    await userEvent.click(canvas.getByRole('button', { name: /Next step/i }))
    await expect(canvas.getByRole('button', { name: /Exit tour/i })).toBeInTheDocument()
  },
}
