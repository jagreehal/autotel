# Community framework skeleton

Minimal HTTP framework showing how to integrate Autotel with `defineFrameworkIntegration`.

```ts
import { defineFrameworkIntegration } from 'autotel-adapters/toolkit';
import { createLoggerStorage } from 'autotel-adapters/toolkit/storage';

const { storage, useLogger } = createLoggerStorage(
  'middleware context. Register communityMiddleware() first.',
);

const integration = defineFrameworkIntegration({
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
  return async (ctx, next) =>
    integration.runTraced(ctx, options, async (handle) => {
      if (handle.skipped) return next();
      await handle.runWith(() => next());
      await handle.finish({ status: ctx.res.status });
    });
}

export { useLogger };
```

See [`packages/autotel-adapters/README.md`](../packages/autotel-adapters/README.md) for built-in framework adapters.
