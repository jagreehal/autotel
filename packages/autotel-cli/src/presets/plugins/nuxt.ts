import type { PluginPreset } from '../../types/index';

export const nuxt: PluginPreset = {
  name: 'Nuxt',
  slug: 'nuxt',
  type: 'plugin',
  description: 'Nuxt module exposing Nitro Autotel adapters',
  packages: {
    required: ['autotel-nuxt', 'autotel-adapters'],
    optional: [],
    devOnly: [],
  },
  env: { required: [], optional: [] },
  imports: [],
  configBlock: {
    type: 'plugin',
    code: `// nuxt.config.ts
// export default defineNuxtConfig({ modules: ['autotel-nuxt'] });`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    "Add modules: ['autotel-nuxt'] to nuxt.config.ts",
    'Wrap server/api handlers with withAutotelEventHandler from autotel-nuxt/runtime/nitro',
  ],
};
