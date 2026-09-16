import type { GenAiSpan } from './types';

export type SpanLabel =
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; text: string }
  | { kind: 'model'; text: string };

/**
 * Headline for a GenAI span in the list row and detail header. Agent and
 * tool spans carry no provider/model, so they are titled by agent or tool
 * name instead.
 */
export function spanLabel(span: GenAiSpan): SpanLabel {
  const model = span.responseModel ?? span.requestModel;
  const noModel = span.provider === 'unknown' || model === 'unknown';
  if (span.agent?.name && noModel)
    return { kind: 'agent', text: `agent: ${span.agent.name}` };
  if (span.operation === 'execute_tool' && span.tool?.name && noModel)
    return { kind: 'tool', text: `tool: ${span.tool.name}` };
  return { kind: 'model', text: `${span.provider}/${model}` };
}
