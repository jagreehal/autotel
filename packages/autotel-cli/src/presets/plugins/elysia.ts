import type { PluginPreset } from '../../types/index';

export const elysia: PluginPreset = {
  name: 'Elysia',
  slug: 'elysia',
  type: 'plugin',
  description: 'Route handler wrapper with request-scoped logger',
  packages: {
    required: ['autotel-adapters'],
    optional: [],
    devOnly: [],
  },
  env: { required: [], optional: [] },
  imports: [
    {
      source: 'autotel-adapters/elysia',
      specifiers: ['withAutotelHandler', 'useLogger'],
    },
  ],
  configBlock: {
    type: 'plugin',
    code: `// app.get('/health', withAutotelHandler(async ({ path }) => {
//   useLogger().set({ route: path });
//   return { ok: true };
// }));`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Wrap route handlers with withAutotelHandler()',
    'Call useLogger() inside handlers for request-scoped context',
  ],
};
