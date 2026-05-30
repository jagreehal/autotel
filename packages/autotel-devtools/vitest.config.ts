/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

// Two projects so the Svelte `browser` resolve condition (needed by
// @testing-library/svelte's render/mount) does NOT leak into the Node server
// tests — under `browser`, packages like `ws` resolve to a browser stub and
// `new WebSocketServer()` breaks.
export default defineConfig({
  test: {
    projects: [
      {
        // Server library — pure Node, no Svelte, no browser condition.
        test: {
          name: 'server',
          include: ['src/server/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Widget — Svelte components + signal-shim logic. svelte compiles
        // .svelte/.svelte.ts; svelteTesting adds the browser resolve condition.
        plugins: [svelte({ emitCss: false }), svelteTesting()],
        test: {
          name: 'widget',
          include: ['src/widget/**/*.test.ts', 'src/widget/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
