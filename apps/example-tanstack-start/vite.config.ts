import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

const config = defineConfig({
  plugins: [
    devtools(),
    netlify(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  // autotel-tanstack uses package.json "browser" conditional exports
  // but autotel (Node.js) must be externalized from client builds
  build: {
    rollupOptions: {
      external: (id) => {
        // Externalize autotel and Node.js modules for client builds
        if (id === 'autotel' || id.startsWith('autotel/')) {
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
