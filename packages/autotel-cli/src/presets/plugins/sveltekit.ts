import type { PluginPreset } from '../../types/index';

export const sveltekit: PluginPreset = {
  name: 'SvelteKit',
  slug: 'sveltekit',
  type: 'plugin',
  description: 'Server handle hook with request-scoped Autotel logger',
  packages: {
    required: ['autotel-adapters'],
    optional: [],
    devOnly: [],
  },
  env: { required: [], optional: [] },
  imports: [
    {
      source: 'autotel-adapters/sveltekit',
      specifiers: ['autotelHandle'],
    },
  ],
  configBlock: {
    type: 'plugin',
    code: `// src/hooks.server.ts
// export const handle = autotelHandle();`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Export autotelHandle() from src/hooks.server.ts',
    'Use useLogger() in +server.ts routes and server loads',
  ],
};
