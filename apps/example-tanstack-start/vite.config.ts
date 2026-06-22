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
  // autotel-tanstack uses package.json "browser" conditional exports
  // but autotel (Node.js) must be externalized from client builds
  build: {
    rollupOptions: {
      external: (id) => {
        // Externalize autotel and Node.js modules for client builds
        if (
          id === 'autotel' ||
          id.startsWith('autotel/') ||
          id === 'autotel-edge' ||
          id.startsWith('autotel-edge/')
        ) {
          return true
        }
        return false
      },
    },
  },
  // Prevent Vite from trying to optimize these Node.js-only dependencies
  optimizeDeps: {
    exclude: ['autotel'],
  },
})

export default config
