import { skybridge } from '@skybridge/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';

export default defineConfig({
  // SAFETY: the plugin is a Vite plugin; its declared type comes from the
  // Vite copy Skybridge was built against, which TypeScript sees as distinct.
  plugins: [skybridge() as PluginOption, react()],
});
