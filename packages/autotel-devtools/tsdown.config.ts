import { defineConfig } from 'tsdown'
import { tsupCompatOutExtensions } from "../../tsdown.shared.mjs";

export default defineConfig({
  outExtensions: tsupCompatOutExtensions,
  tsconfig: 'tsconfig.build.json',
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'server/index': 'src/server/index.ts',
    'server/exporter': 'src/server/exporter.ts',
    'server/log-exporter': 'src/server/log-exporter.ts',
    'server/remote-exporter': 'src/server/remote-exporter.ts',
    'genai/index': 'src/widget/genai/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  minify: false,
  deps: {
    neverBundle: [
    'ws',
    '@opentelemetry/api',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/core',
    'autotel',
  ],
  },
  clean: false,
  target: false,
})
