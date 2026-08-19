import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent } from 'storybook/test';
import GenAiView from './GenAiView.svelte';
import { tracesSignal } from '../store.svelte';
import type { SpanData, TraceData } from '../types';
import openaiChat from '../genai/__fixtures__/openai-v2-chat.json';
import anthropicCache from '../genai/__fixtures__/anthropic-cache.json';
import openaiAgentsHandoff from '../genai/__fixtures__/openai-agents-handoff.json';
import aisdkOllama from '../genai/__fixtures__/aisdk-ollama-real.json';
import aisdkTools from '../genai/__fixtures__/aisdk-ollama-tools-real.json';
import pydanticAi from '../genai/__fixtures__/pydantic-ai-ollama-real.json';
import gemini from '../genai/__fixtures__/gemini-pydantic-real.json';
import langchain from '../genai/__fixtures__/langchain-ollama-real.json';
import genaiGuard from '../genai/__fixtures__/autotel-genai-guard.json';

// `GenAiView.svelte` takes no props — it derives its rows from `tracesSignal`
// (via the `genAiRowsSignal` computed). The Preact stories passed a `raw` span
// arg into a local `ComponentPair`/`GenAiViewHarness` helper; those helpers do
// not exist in the Svelte port. Each story now seeds `tracesSignal` from its
// fixtures in `beforeEach` and tears it down afterwards. The play() assertions
// are unchanged — `GenAiView` renders the list + selected span header/panel, so
// the same text is on screen.

/**
 * A recorded fixture, read back as the devtools' own span shape.
 *
 * SAFETY: these JSON files are span batches this devtools exported itself.
 * TypeScript types an imported JSON module structurally - every field becomes
 * required and every literal narrows - which does not match SpanData's declared
 * optional members, so the shape has to be restated once here.
 */
function fixtureSpans(fixture: JsonFixture): SpanData[] {
  // SAFETY: see the note above.
  return fixture as unknown as SpanData[];
}

/**
 * An imported fixture, before it is read as spans - the exact set of files
 * imported above, so a fixture that changes shape is a compile error here
 * rather than something the assertion quietly absorbs.
 */
type JsonFixture =
  | typeof openaiChat
  | typeof anthropicCache
  | typeof openaiAgentsHandoff
  | typeof aisdkOllama
  | typeof aisdkTools
  | typeof pydanticAi
  | typeof gemini
  | typeof langchain
  | typeof genaiGuard;

/** A single-span fixture, read back as the devtools' own span shape. */
function fixtureSpan(fixture: JsonFixture): SpanData {
  // SAFETY: see the note on fixtureSpans.
  return fixture as unknown as SpanData;
}

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
  }));
  tracesSignal.value = traces;
  return () => {
    tracesSignal.value = [];
  };
}

const meta = {
  title: 'GenAI/Single span',
  component: GenAiView,
} satisfies Meta<typeof GenAiView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OpenAiChat: Story = {
  beforeEach: () => seedTraces([[fixtureSpan(openaiChat)]]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('openai')).toBeInTheDocument();
    await expect(
      canvas.getAllByText('gpt-4o-mini-2024-07-18').length,
    ).toBeGreaterThan(0);
    await expect(canvas.getByText('This is a test.')).toBeInTheDocument();
  },
};

export const AnthropicCacheHit: Story = {
  beforeEach: () => seedTraces([[fixtureSpan(anthropicCache)]]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('anthropic')).toBeInTheDocument();
    // ModelHeader spells out the cached token share inline, e.g. "176 (100 cached)".
    await expect(canvas.getByText(/\(\d+ cached\)/)).toBeInTheDocument();
  },
};

export const OpenAiAgentsHandoff: Story = {
  beforeEach: () => seedTraces([[fixtureSpan(openaiAgentsHandoff)]]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Agent handoff')).toBeInTheDocument();
    await expect(canvas.getAllByText('Triage Agent').length).toBeGreaterThan(0);
    await expect(canvas.getByText('Refunds Specialist')).toBeInTheDocument();
  },
};

export const VercelAiSdkOllamaReal: Story = {
  beforeEach: () =>
    seedTraces([
      [
        fixtureSpans(aisdkOllama).find(
          (s) => s.name === 'ai.generateText.doGenerate',
        )!,
      ],
    ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('ollama')).toBeInTheDocument();
    await expect(canvas.getAllByText('granite4.1:3b').length).toBeGreaterThan(
      0,
    );
  },
};

export const PydanticAiLogfireReal: Story = {
  beforeEach: () =>
    seedTraces([
      [fixtureSpans(pydanticAi).find((s) => s.name.startsWith('chat '))!],
    ]),
  play: async ({ canvas }) => {
    // GenAiView renders the span list + selected detail, so provider/op labels
    // appear in both the row and the header — assert presence via AllByText.
    await expect((await canvas.findAllByText('ollama')).length).toBeGreaterThan(
      0,
    );
    await expect(canvas.getAllByText('chat').length).toBeGreaterThan(0);
  },
};

export const GeminiPydanticReal: Story = {
  beforeEach: () =>
    seedTraces([
      [fixtureSpans(gemini).find((s) => s.name.startsWith('chat '))!],
    ]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('google')).toBeInTheDocument();
    await expect(canvas.getAllByText(/^gemini-/).length).toBeGreaterThan(0);
  },
};

export const LangChainOllamaReal: Story = {
  beforeEach: () => seedTraces([[fixtureSpans(langchain)[0]]]),
  play: async ({ canvas }) => {
    await expect((await canvas.findAllByText('ollama')).length).toBeGreaterThan(
      0,
    );
    await expect(canvas.getAllByText('chat').length).toBeGreaterThan(0);
  },
};

export const FullViewAllFixtures: Story = {
  beforeEach: () =>
    seedTraces([
      [fixtureSpan(openaiChat)],
      [fixtureSpan(anthropicCache)],
      [fixtureSpan(openaiAgentsHandoff)],
      fixtureSpans(aisdkOllama),
      fixtureSpans(pydanticAi),
      fixtureSpans(aisdkTools),
      fixtureSpans(gemini),
      fixtureSpans(langchain),
    ]),
  play: async ({ canvas }) => {
    await expect(
      (await canvas.findAllByText(/openai\/gpt-4o-mini/i)).length,
    ).toBeGreaterThan(0);
    await expect(await canvas.findByText(/anthropic\//)).toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: /Timeline/i }),
    ).toBeInTheDocument();
  },
};

export const VercelAiSdkToolsReal: Story = {
  beforeEach: () => seedTraces([fixtureSpans(aisdkTools)]),
  play: async ({ canvas }) => {
    await expect(
      (await canvas.findAllByText(/ollama\/qwen2:latest/i)).length,
    ).toBeGreaterThan(0);
    await expect(await canvas.findByText('Explain run')).toBeInTheDocument();

    const toolName = await canvas.findByText('lookupTraveler');
    await userEvent.click(toolName);
    await expect(await canvas.findByText('Input')).toBeInTheDocument();
  },
};

// Trace mode decomposes the selected run into a depth-indented tree of steps,
// tools and text — switching to it surfaces the tool the model invoked.
export const TraceMode: Story = {
  beforeEach: () => seedTraces([fixtureSpans(aisdkTools)]),
  play: async ({ canvas }) => {
    const traceBtn = await canvas.findByRole('button', { name: /^Trace$/i });
    await userEvent.click(traceBtn);
    await expect(
      (await canvas.findAllByText(/Tool: lookupTraveler/i)).length,
    ).toBeGreaterThan(0);
  },
};

// autotel-genai: reported cost, streaming throughput (TTFC + tok/s), a guard
// that stopped the run on a cost ceiling, and a provider warning — all surfaced
// in the model header.
export const GenAiGuardAndStreaming: Story = {
  beforeEach: () => seedTraces([[fixtureSpan(genaiGuard)]]),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('openai')).toBeInTheDocument();
    // Guard chip shows the firing rule.
    await expect(
      await canvas.findByText(/guard: cost-ceiling:\$10/i),
    ).toBeInTheDocument();
    // Streaming throughput chip (output tokens/second).
    await expect(canvas.getByText(/tok\/s/i)).toBeInTheDocument();
    // Provider warning chip.
    await expect(canvas.getByText(/1 warning/i)).toBeInTheDocument();
  },
};

// A multi-span run shows the run-summary strip (cost/tokens/tools) and the
// "Explain run" guided tour. The tour
// steps through the run with plain-language narration; here we open it and
// assert the first narrated step renders.
export const RunSummaryAndGuidedTour: Story = {
  beforeEach: () => seedTraces([fixtureSpans(aisdkTools)]),
  play: async ({ canvas }) => {
    // Run summary strip appears above the detail for a multi-span run.
    await expect((await canvas.findAllByText('Tokens')).length).toBeGreaterThan(
      0,
    );
    await expect(canvas.getAllByText('Tools').length).toBeGreaterThan(0);

    // Start the guided tour.
    const explain = await canvas.findByRole('button', { name: /Explain run/i });
    await userEvent.click(explain);

    // The narration banner renders a step counter and exit control.
    await expect(
      await canvas.findByRole('region', { name: /Guided tour/i }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: /Exit tour/i }),
    ).toBeInTheDocument();

    // Advance one step.
    await userEvent.click(canvas.getByRole('button', { name: /Next step/i }));
    await expect(
      canvas.getByRole('button', { name: /Exit tour/i }),
    ).toBeInTheDocument();
  },
};

// The `trace …` reference in the model header is a button that opens the trace
// in the Traces waterfall (DX: jump straight from a generation to its trace).
export const TraceReferenceIsClickable: Story = {
  beforeEach: () => seedTraces([[fixtureSpan(openaiChat)]]),
  play: async ({ canvas }) => {
    const traceLink = await canvas.findByTitle('Open trace in waterfall');
    await expect(traceLink).toBeInTheDocument();
    await expect(traceLink.tagName).toBe('BUTTON');
    await expect(traceLink.textContent).toMatch(/^trace /);
  },
};
