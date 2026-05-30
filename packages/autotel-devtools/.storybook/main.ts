import type { StorybookConfig } from '@storybook/svelte-vite';

import { dirname } from 'path';

import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|mjs|ts|svelte)'],
  addons: [
    getAbsolutePath('@chromatic-com/storybook'),
    getAbsolutePath('@storybook/addon-vitest'),
    getAbsolutePath('@storybook/addon-a11y'),
  ],
  framework: {
    name: getAbsolutePath('@storybook/svelte-vite') as '@storybook/svelte-vite',
    // The svelte component-docgen plugin parses raw `.svelte` source with the
    // bundler's JS parser (storybook 10.4 + rolldown), which chokes on
    // `<script lang="ts">`. We have no Docs tab (addon-docs removed) and every
    // story declares explicit args, so the inferred prop tables aren't needed.
    options: { docgen: false },
  },
  async viteFinal(config) {
    // The svelte-vite framework doesn't add the compile plugin to the build
    // pipeline (rolldown parses raw .svelte otherwise), so add it explicitly —
    // this config is also applied to the storybook vitest run via storybookTest.
    // prebundleSvelteLibraries:false: the browser-mode dep optimizer (rolldown)
    // can't parse `new.target` in svelte 5's compiled output, and its
    // optimize-module hook tries to re-compile @storybook/svelte's precompiled
    // `.svelte.js` helpers. Disabling prebundle skips both — the svelte plugin
    // transforms libraries on demand instead. emitCss:false matches the widget
    // build (shadow-DOM styling).
    return {
      ...config,
      plugins: [
        ...(config.plugins || []),
        svelte({ emitCss: false, prebundleSvelteLibraries: false }),
        tailwindcss(),
      ],
    };
  },
};
export default config;
