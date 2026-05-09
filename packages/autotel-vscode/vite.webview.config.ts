import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist/webview',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: 'src/webview/ui/index.tsx',
      output: {
        format: 'iife',
        entryFileNames: 'span-detail.js',
        assetFileNames: 'span-detail.[ext]',
      },
    },
  },
})
