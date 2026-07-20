import { init } from 'autotel';
import { withAutotelHandler, useLogger } from 'autotel-adapters/elysia';

init({ service: 'example-elysia' });

export const health = withAutotelHandler(async (ctx) => {
  useLogger().set({ route: ctx.path });
  return { ok: true };
});
