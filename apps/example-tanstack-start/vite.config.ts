import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

const appDir = path.dirname(fileURLToPath(import.meta.url))

const config = defineConfig({
  plugins: [devtools(), netlify(), tailwindcss(), tanstackStart(), viteReact()],
  resolve: {
    alias: {
      '@': path.resolve(appDir, './src'),
    },
    // Prefer package.json "browser" exports (autotel-tanstack client stubs)
    conditions: ['browser', 'module', 'import', 'default'],
    tsconfigPaths: true,
  },
  // autotel stays a runtime dependency of the server bundle. Only the `ssr`
  // environment: an external in the client bundle is left as a bare specifier
  // the browser cannot resolve, and browser-safe subpaths (autotel-posthog
  // imports autotel/feature-flags) must be bundled there.
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          external: (id) =>
            id === 'autotel' ||
            id.startsWith('autotel/') ||
            id === 'autotel-edge' ||
            id.startsWith('autotel-edge/'),
        },
      },
    },
  },
  // Prevent Vite from trying to optimize these Node.js-only dependencies
  optimizeDeps: {
    exclude: ['autotel'],
  },
})

export default config
