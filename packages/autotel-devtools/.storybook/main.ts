import type { StorybookConfig } from '@storybook/preact-vite';

import { dirname } from 'path';

import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    getAbsolutePath('@chromatic-com/storybook'),
    getAbsolutePath('@storybook/addon-vitest'),
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-docs'),
  ],
  framework: getAbsolutePath('@storybook/preact-vite'),
  async viteFinal(config) {
    return {
      ...config,
      plugins: [...(config.plugins || []), tailwindcss()],
    };
  },
};
export default config;
