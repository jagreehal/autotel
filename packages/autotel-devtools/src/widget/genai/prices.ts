// Per-million-token USD pricing. Intentionally a tiny seed table — PRs to
// expand. Keys are `${provider}/${model}` lowercased; model is matched by
// startsWith so versioned suffixes (e.g. `-2025-01-01`) hit the base price.
//
// Anthropic cache rates follow public published ratios:
//   cache_read = 0.1x input rate, cache_write = 1.25x input rate.

export interface PriceEntry {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok?: number
  cacheWritePerMTok?: number
}

const TABLE: Record<string, PriceEntry> = {
  'openai/gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  'openai/gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'openai/gpt-4-turbo': { inputPerMTok: 10, outputPerMTok: 30 },
  'openai/gpt-3.5-turbo': { inputPerMTok: 0.5, outputPerMTok: 1.5 },
  'anthropic/claude-opus-4': { inputPerMTok: 15, outputPerMTok: 75 },
  'anthropic/claude-sonnet-4': { inputPerMTok: 3, outputPerMTok: 15 },
  'anthropic/claude-3-5-sonnet': { inputPerMTok: 3, outputPerMTok: 15 },
  'anthropic/claude-3-5-haiku': { inputPerMTok: 0.8, outputPerMTok: 4 },
  'anthropic/claude-3-opus': { inputPerMTok: 15, outputPerMTok: 75 },
  'anthropic/claude-3-haiku': { inputPerMTok: 0.25, outputPerMTok: 1.25 },
  'google/gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'google/gemini-2.0-flash': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'google/gemini-1.5-pro': { inputPerMTok: 1.25, outputPerMTok: 5 },
  'google/gemini-1.5-flash': { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  'mistral/mistral-large': { inputPerMTok: 2, outputPerMTok: 6 },
  'mistral/mistral-small': { inputPerMTok: 0.2, outputPerMTok: 0.6 },
  'groq/llama-3.1-70b': { inputPerMTok: 0.59, outputPerMTok: 0.79 },
  'deepseek/deepseek-chat': { inputPerMTok: 0.27, outputPerMTok: 1.1 },
}

function normalizeProvider(provider: string): string {
  const p = provider.toLowerCase()
  if (p === 'az.ai.openai' || p === 'azure_openai') return 'openai'
  if (p === 'vertex_ai' || p === 'gcp.vertex_ai' || p === 'gcp.gemini') return 'google'
  return p
}

// Match by longest-prefix so `gpt-4o-mini-2024-07-18` resolves to
// `gpt-4o-mini`, not the shorter `gpt-4o`. Cache the sorted index per table
// since the table is module-local and effectively immutable at runtime.
const SORTED_KEYS = Object.keys(TABLE).sort((a, b) => {
  const am = a.split('/')[1] ?? ''
  const bm = b.split('/')[1] ?? ''
  return bm.length - am.length
})

export function lookupPrice(provider: string, model: string): PriceEntry | undefined {
  const normalizedProvider = normalizeProvider(provider)
  const normalizedModel = model.toLowerCase()
  for (const key of SORTED_KEYS) {
    const [tableProvider, tableModel] = key.split('/')
    if (tableProvider === normalizedProvider && normalizedModel.startsWith(tableModel)) {
      return TABLE[key]
    }
  }
  return undefined
}

interface PriceInputs {
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export interface PriceOutputs {
  currency: 'USD'
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  source: 'table' | 'unknown'
}

export function priceCall(inputs: PriceInputs): PriceOutputs {
  const entry = lookupPrice(inputs.provider, inputs.model)
  if (!entry) {
    return { currency: 'USD', input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, source: 'unknown' }
  }
  const cacheReadRate = entry.cacheReadPerMTok ?? entry.inputPerMTok * 0.1
  const cacheWriteRate = entry.cacheWritePerMTok ?? entry.inputPerMTok * 1.25
  const cacheRead = ((inputs.cacheReadInputTokens ?? 0) / 1_000_000) * cacheReadRate
  const cacheWrite = ((inputs.cacheCreationInputTokens ?? 0) / 1_000_000) * cacheWriteRate
  const billableInputTokens = Math.max(
    0,
    (inputs.inputTokens ?? 0) - (inputs.cacheReadInputTokens ?? 0) - (inputs.cacheCreationInputTokens ?? 0),
  )
  const input = (billableInputTokens / 1_000_000) * entry.inputPerMTok
  const output = ((inputs.outputTokens ?? 0) / 1_000_000) * entry.outputPerMTok
  const total = input + output + cacheRead + cacheWrite
  return { currency: 'USD', input, output, cacheRead, cacheWrite, total, source: 'table' }
}
