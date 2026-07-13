// Shared machinery for `${provider}/${model}` seed-table lookups — used by both
// `prices.ts` and `contextWindows.ts`, which otherwise re-implemented the same
// provider-alias normalization and longest-model-prefix match (and could drift).

/** Fold provider aliases (Azure→openai, Vertex/Gemini→google) to a base key. */
export function normalizeProvider(provider: string): string {
  const p = provider.toLowerCase()
  if (p === 'az.ai.openai' || p === 'azure_openai') return 'openai'
  if (p === 'vertex_ai' || p === 'gcp.vertex_ai' || p === 'gcp.gemini') return 'google'
  return p
}

/**
 * Build a lookup over a `${provider}/${model}` (lowercased) table that matches
 * by normalized provider + **longest** model prefix, so `gpt-4o-mini-2024-07-18`
 * resolves to `gpt-4o-mini`, not the shorter `gpt-4o`. Keys are sorted once.
 */
export function makeProviderModelLookup<T>(
  table: Record<string, T>,
): (provider: string, model: string) => T | undefined {
  const sortedKeys = Object.keys(table).sort((a, b) => {
    const am = a.split('/')[1] ?? ''
    const bm = b.split('/')[1] ?? ''
    return bm.length - am.length
  })
  return (provider, model) => {
    const normalizedProvider = normalizeProvider(provider)
    const normalizedModel = model.toLowerCase()
    for (const key of sortedKeys) {
      const [tableProvider, tableModel] = key.split('/')
      if (tableProvider === normalizedProvider && normalizedModel.startsWith(tableModel)) {
        return table[key]
      }
    }
    return undefined
  }
}
