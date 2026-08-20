import { securityEvent } from 'autotel-audit';
import {
  resolveContext,
  toAttributeValue,
  type AgentContext,
} from './context.js';
import type { Attributes } from '@opentelemetry/api';

/** Canonical eval-run attribute keys for sandbox / IR correlation. */
export const EVAL_IDENTITY_ATTR = {
  runId: 'eval.run_id',
  taskId: 'eval.task_id',
  sandboxId: 'eval.sandbox_id',
} as const;

export interface RecordEvalRunIdentityInput {
  ctx?: AgentContext;
  runId: string;
  taskId?: string;
  sandboxId?: string;
}

function setEvalAttrs(ctx: AgentContext | undefined, attrs: Attributes): void {
  const traceCtx = resolveContext(ctx);
  const mapped: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const attr = toAttributeValue(value);
    if (
      typeof attr === 'string' ||
      typeof attr === 'number' ||
      typeof attr === 'boolean'
    ) {
      mapped[key] = attr;
    }
  }
  if (Object.keys(mapped).length > 0) {
    traceCtx.setAttributes(mapped);
  }
}

/** Stamp eval-run identity on the active span for cross-agent IR queries. */
export function recordEvalRunIdentity(input: RecordEvalRunIdentityInput): void {
  setEvalAttrs(input.ctx, {
    [EVAL_IDENTITY_ATTR.runId]: input.runId,
    ...(input.taskId !== undefined && {
      [EVAL_IDENTITY_ATTR.taskId]: input.taskId,
    }),
    ...(input.sandboxId !== undefined && {
      [EVAL_IDENTITY_ATTR.sandboxId]: input.sandboxId,
    }),
  });
}
