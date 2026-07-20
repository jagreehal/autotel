import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    module: 'src/module.ts',
    'runtime/nitro': 'src/runtime/nitro.ts',
    'runtime/autotel.plugin': 'src/runtime/autotel.plugin.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  outDir: 'dist',
  clean: true,
  treeshake: true,
  target: false,
  external: ['@nuxt/kit', 'nuxt', 'nitropack', 'autotel-adapters', 'autotel-adapters/nitro', 'autotel'],
});
