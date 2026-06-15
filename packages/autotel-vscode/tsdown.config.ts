import { defineConfig } from 'tsdown'
import { tsupCompatOutExtensions } from "../../tsdown.shared.mjs";

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  entry: { extension: 'src/extension.ts' },
  outDir: 'dist',
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  sourcemap: true,
  clean: true,
  dts: false,
  // CRITICAL: bundle autotel-devtools (and subexports) into dist.
  // The .vsix has no node_modules; runtime resolution will fail otherwise.
  esbuildOptions(options) {
    options.conditions = ['require', 'node', 'default']
  },
  deps: {
    neverBundle: ['vscode'],
    alwaysBundle: [/^autotel-devtools($|\/)/],
  },
})
