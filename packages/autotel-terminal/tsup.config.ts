import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.tsx',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  external: ['autotel', 'ai', 'ai-sdk-ollama', '@ai-sdk/openai', '@ai-sdk/openai-compatible'],
});
