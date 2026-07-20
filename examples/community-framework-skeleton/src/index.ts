import { defineFrameworkIntegration } from 'autotel-adapters/toolkit';
import { createLoggerStorage } from 'autotel-adapters/toolkit/storage';

interface CommunityContext {
  req: { method: string; path: string; headers: Headers };
  res: { status: number };
  state: { logger?: unknown };
}

const { storage, useLogger } = createLoggerStorage(
  'middleware context. Register communityMiddleware() first.',
);

const integration = defineFrameworkIntegration<CommunityContext>({
  name: 'community',
  storage,
  extractRequest: (ctx) => ({
    method: ctx.req.method,
    path: ctx.req.path,
    headers: ctx.req.headers,
  }),
  attachLogger: (ctx, logger) => {
    ctx.state.logger = logger;
  },
});

export function communityMiddleware(options = {}) {
  return async (ctx: CommunityContext, next: () => Promise<void>) =>
    integration.runTraced(ctx, options, async (handle) => {
      if (handle.skipped) return next();
      await handle.runWith(() => next());
      await handle.finish({ status: ctx.res.status });
    });
}

export { useLogger };
