import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/postcss'

// Widget build — IIFE for browser, CSS inlined
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/widget/auto.ts'),
      name: 'AutotelDevtools',
      formats: ['iife'],
      fileName: () => 'widget.global.js',
    },
    outDir: 'dist',
    emptyOutDir: false, // don't wipe server build
    target: 'es2020',
    minify: true,
    cssCodeSplit: false, // inline all CSS into the JS bundle
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  plugins: [
    preact(),
  ],
})
