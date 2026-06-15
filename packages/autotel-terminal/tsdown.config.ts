import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from "../../tsdown.shared.mjs";

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.tsx',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  deps: {
    neverBundle: ['autotel', 'ai', 'ai-sdk-ollama', '@ai-sdk/openai', '@ai-sdk/openai-compatible'],
  },
  target: false,
});
