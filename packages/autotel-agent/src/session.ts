import { buildLifecycleUpdateContext } from './metadata.js';
import { setAgentAttributes } from './attributes.js';
import { withAgentAction } from './runtime.js';
import type {
  AgentActionOptions,
  AgentHandler,
  AgentSessionActionMetadata,
} from './types.js';

function toIsoString(value?: string | Date): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

export async function withAgentSession<T>(
  metadata: AgentSessionActionMetadata,
  fn: AgentHandler<T>,
  options: AgentActionOptions = {},
): Promise<T> {
  const startedAt = toIsoString(metadata.session?.startedAt);

  return withAgentAction(
    {
      ...metadata,
      category: metadata.category ?? 'agent_session',
      session: {
        ...metadata.session,
        status: metadata.session?.status ?? 'active',
        startedAt,
      },
    },
    async (ctx, logger) => {
      try {
        const result = await fn(ctx, logger);
        const completed = {
          ...metadata,
          outcome: metadata.outcome ?? 'success',
          session: {
            ...metadata.session,
            status: 'completed' as const,
            startedAt,
            endedAt: new Date().toISOString(),
          },
        };
        setAgentAttributes(completed, ctx);
        logger.set(buildLifecycleUpdateContext(completed));
        return result;
      } catch (error) {
        const failed = {
          ...metadata,
          outcome: 'failure' as const,
          session: {
            ...metadata.session,
            status: 'failed' as const,
            startedAt,
            endedAt: new Date().toISOString(),
          },
        };
        setAgentAttributes(failed, ctx);
        logger.set(buildLifecycleUpdateContext(failed));
        throw error;
      }
    },
    options,
  );
}
