// Public entry for the GenAI normalization layer, exposed as the
// `autotel-devtools/genai` package export: re-exports detect/normalize/stitch/
// prices/types so external consumers can pull the pure-TS layer from one path.
// Widget-internal code imports the individual modules directly, not this barrel.

export { isGenAiSpan } from './detect'
export { toGenAiSpan } from './normalize'
export { buildToolResultIndex, hydrateToolResults } from './stitch'
export { lookupPrice, priceCall } from './prices'
export type {
  GenAiCost,
  GenAiGuard,
  GenAiMessage,
  GenAiMessagePart,
  GenAiOperation,
  GenAiRole,
  GenAiSession,
  GenAiSpan,
  GenAiStreaming,
  GenAiToolCall,
  GenAiToolDef,
  GenAiUsage,
  GenAiWarning,
} from './types'
