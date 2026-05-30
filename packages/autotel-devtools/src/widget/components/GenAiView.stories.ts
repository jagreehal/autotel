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
    await expect(canvas.getByText('gpt-4o-mini-2024-07-18')).toBeInTheDocument()
    await expect(canvas.getByText('This is a test.')).toBeInTheDocument()
  },
}

export const AnthropicCacheHit: Story = {
  beforeEach: () => seedTraces([[anthropicCache as unknown as SpanData]]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('anthropic')).toBeInTheDocument()
    await expect(canvas.getByText(/% cached/)).toBeInTheDocument()
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
    await expect(canvas.getByText('granite4.1:3b')).toBeInTheDocument()
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
    await expect(canvas.getByText(/^gemini-/)).toBeInTheDocument()
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

    const toolName = await canvas.findByText('lookupTraveler')
    await userEvent.click(toolName)
    await expect(await canvas.findByText('Input')).toBeInTheDocument()
  },
}
