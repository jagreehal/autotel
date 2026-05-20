import { h } from 'preact'
import type { Meta, StoryObj } from '@storybook/preact-vite'
import { useEffect } from 'preact/hooks'
import { GenAiView } from '../components/GenAiView'
import { ModelHeader } from '../components/genai/ModelHeader'
import { ConversationPanel } from '../components/genai/ConversationPanel'
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

export const OpenAiChat: Story = { args: { raw: openaiChat as unknown as SpanData } }
export const AnthropicCacheHit: Story = { args: { raw: anthropicCache as unknown as SpanData } }
export const OpenAiAgentsHandoff: Story = { args: { raw: openaiAgentsHandoff as unknown as SpanData } }
export const VercelAiSdkOllamaReal: Story = {
  args: {
    raw: (aisdkOllama as unknown as SpanData[]).find(
      (s) => s.name === 'ai.generateText.doGenerate',
    )!,
  },
}
export const PydanticAiLogfireReal: Story = {
  args: {
    raw: (pydanticAi as unknown as SpanData[]).find((s) => s.name.startsWith('chat '))!,
  },
}
export const GeminiPydanticReal: Story = {
  args: {
    raw: (gemini as unknown as SpanData[]).find((s) => s.name.startsWith('chat '))!,
  },
}
export const LangChainOllamaReal: Story = {
  args: {
    raw: (langchain as unknown as SpanData[])[0],
  },
}

// Full-view story that drives the master/detail layout off the store.
function GenAiViewHarness({ fixtures }: { fixtures: SpanData[][] }) {
  useEffect(() => {
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
  }, [])
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
}

// Dedicated story for the agentic tools capture so the ToolCallCard polish
// (purple-themed, inline param summary, Input/Output split) is easy to find.
export const VercelAiSdkToolsReal: StoryObj<typeof GenAiViewHarness> = {
  render: () => <GenAiViewHarness fixtures={[aisdkTools as unknown as SpanData[]]} />,
}
