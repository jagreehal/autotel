import { h } from 'preact'
import type { Meta, StoryObj } from '@storybook/preact-vite'
import { useLayoutEffect } from 'preact/hooks'
import { expect } from 'storybook/test'
import { GenAiView } from './GenAiView'
import { ModelHeader } from './genai/ModelHeader'
import { ConversationPanel } from './genai/ConversationPanel'
import { toGenAiSpan } from '../genai/normalize'
import { tracesSignal } from '../store'
import type { SpanData, TraceData } from '../types'
import openaiChat from '../genai/__fixtures__/openai-v2-chat.json'
import anthropicCache from '../genai/__fixtures__/anthropic-cache.json'
import openaiAgentsHandoff from '../genai/__fixtures__/openai-agents-handoff.json'
import aisdkOllama from '../genai/__fixtures__/aisdk-ollama-real.json'
import aisdkTools from '../genai/__fixtures__/aisdk-ollama-tools-real.json'
import pydanticAi from '../genai/__fixtures__/pydantic-ai-ollama-real.json'
import gemini from '../genai/__fixtures__/gemini-pydantic-real.json'
import langchain from '../genai/__fixtures__/langchain-ollama-real.json'

function ComponentPair({ raw }: { raw: SpanData }) {
  const span = toGenAiSpan(raw)
  return (
    <div className="w-[720px] border border-zinc-200 rounded-lg overflow-hidden bg-white">
      <ModelHeader span={span} />
      <ConversationPanel span={span} />
    </div>
  )
}

const meta: Meta<typeof ComponentPair> = {
  title: 'GenAI/Single span',
  component: ComponentPair,
}
export default meta
type Story = StoryObj<typeof ComponentPair>

export const OpenAiChat: Story = {
  args: { raw: openaiChat as unknown as SpanData },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('openai')).toBeInTheDocument()
    await expect(canvas.getByText('gpt-4o-mini-2024-07-18')).toBeInTheDocument()
    await expect(canvas.getByText('This is a test.')).toBeInTheDocument()
  },
}

export const AnthropicCacheHit: Story = {
  args: { raw: anthropicCache as unknown as SpanData },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('anthropic')).toBeInTheDocument()
    await expect(canvas.getByText(/% cached/)).toBeInTheDocument()
  },
}

export const OpenAiAgentsHandoff: Story = {
  args: { raw: openaiAgentsHandoff as unknown as SpanData },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Agent handoff')).toBeInTheDocument()
    await expect(canvas.getAllByText('Triage Agent').length).toBeGreaterThan(0)
    await expect(canvas.getByText('Refunds Specialist')).toBeInTheDocument()
  },
}

export const VercelAiSdkOllamaReal: Story = {
  args: {
    raw: (aisdkOllama as unknown as SpanData[]).find(
      (s) => s.name === 'ai.generateText.doGenerate',
    )!,
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('ollama')).toBeInTheDocument()
    await expect(canvas.getByText('granite4.1:3b')).toBeInTheDocument()
  },
}

export const PydanticAiLogfireReal: Story = {
  args: {
    raw: (pydanticAi as unknown as SpanData[]).find((s) => s.name.startsWith('chat '))!,
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('ollama')).toBeInTheDocument()
    await expect(canvas.getByText('chat')).toBeInTheDocument()
  },
}

export const GeminiPydanticReal: Story = {
  args: {
    raw: (gemini as unknown as SpanData[]).find((s) => s.name.startsWith('chat '))!,
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('google')).toBeInTheDocument()
    await expect(canvas.getByText(/^gemini-/)).toBeInTheDocument()
  },
}

export const LangChainOllamaReal: Story = {
  args: {
    raw: (langchain as unknown as SpanData[])[0],
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('ollama')).toBeInTheDocument()
    await expect(canvas.getByText('chat')).toBeInTheDocument()
  },
}

function GenAiViewHarness({ fixtures }: { fixtures: SpanData[][] }) {
  useLayoutEffect(() => {
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
  }, [fixtures])
  return (
    <div className="w-[960px] h-[480px] border border-zinc-200 rounded-lg overflow-hidden bg-white">
      <GenAiView />
    </div>
  )
}

export const FullViewAllFixtures: StoryObj<typeof GenAiViewHarness> = {
  render: () => (
    <GenAiViewHarness
      fixtures={[
        [openaiChat as unknown as SpanData],
        [anthropicCache as unknown as SpanData],
        [openaiAgentsHandoff as unknown as SpanData],
        aisdkOllama as unknown as SpanData[],
        pydanticAi as unknown as SpanData[],
        aisdkTools as unknown as SpanData[],
        gemini as unknown as SpanData[],
        langchain as unknown as SpanData[],
      ]}
    />
  ),
  play: async ({ canvas }) => {
    await expect(
      (await canvas.findAllByText(/openai\/gpt-4o-mini/i)).length,
    ).toBeGreaterThan(0)
    await expect(await canvas.findByText(/anthropic\//)).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /Timeline/i })).toBeInTheDocument()
  },
}

export const VercelAiSdkToolsReal: StoryObj<typeof GenAiViewHarness> = {
  render: () => <GenAiViewHarness fixtures={[aisdkTools as unknown as SpanData[]]} />,
  play: async ({ canvas, userEvent }) => {
    await expect(
      (await canvas.findAllByText(/ollama\/qwen2:latest/i)).length,
    ).toBeGreaterThan(0)

    const toolName = await canvas.findByText('lookupTraveler')
    await userEvent.click(toolName)
    await expect(await canvas.findByText('Input')).toBeInTheDocument()
  },
}
