// Public entry for the GenAI normalization layer. Consumers (the widget
// itself and the VSCode extension) import detect/normalize/stitch/prices/types
// from this single path so the shape stays in sync.

export { isGenAiSpan } from './detect'
export { toGenAiSpan } from './normalize'
export { buildToolResultIndex, hydrateToolResults } from './stitch'
export { lookupPrice, priceCall } from './prices'
export type {
  GenAiCost,
  GenAiMessage,
  GenAiMessagePart,
  GenAiOperation,
  GenAiRole,
  GenAiSpan,
  GenAiToolCall,
  GenAiToolDef,
  GenAiUsage,
} from './types'
