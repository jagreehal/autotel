// Canonical GenAI operation classification, shared by the summary, narration
// and trace builders so "what counts as a model call / an agent invocation"
// has one definition instead of drifting copies.

/** Operations that are a request to a model (and thus carry tokens / cost). */
export const MODEL_OPS = new Set([
  'chat',
  'text_completion',
  'generate_content',
  'embeddings',
])

/** Operations that invoke an agent. */
export const AGENT_OPS = new Set(['invoke_agent', 'create_agent'])
