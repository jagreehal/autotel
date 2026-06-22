import { defineConfig } from 'tsdown';
import { tsupCompatOutExtensions } from '../../tsdown.shared.mjs';

export default defineConfig({
  tsconfig: 'tsconfig.build.json',
  entry: [
    'src/index.ts',
    'src/semconv.ts',
    'src/cost.ts',
    'src/metrics.ts',
    'src/events.ts',
    'src/trace.ts',
    'src/guard.ts',
    'src/streaming.ts',
    'src/ai-sdk-bridge.ts',
    'src/observer/index.ts',
    'src/agent/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  // Tree-shaking is disabled to work around a rolldown 1.1.0 bug: it inlines every
  // static property read of a re-exported `as const` object (e.g. AGENT_PLAN_RISK_ATTR),
  // drops the now-unreferenced declaration, yet leaves the symbol in a chunk's export
  // list — producing `SyntaxError: Export 'X' is not defined in module` at import time.
  // The breakage is non-deterministic across platforms (which binding gets dropped varies)
  // and no by-value reference reliably defeats the constant folding. The cost is ~10KB of
  // retained internal code; consumer tree-shaking is unaffected (subpath exports remain).
  // Re-enable once rolldown fixes the inline-then-drop-but-keep-export bug.
  treeshake: false,
  outExtensions: tsupCompatOutExtensions,
  // Keep the `node:` prefix on built-ins (e.g. `node:crypto`) so the published
  // bundle is explicit about its runtime requirement and Workers-idiomatic.
  nodeProtocol: false,
});
