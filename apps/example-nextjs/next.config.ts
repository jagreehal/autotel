import type { NextConfig } from 'next';
import { withAutotelConfig } from 'autotel-adapters/next-config';

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Transpile these packages so they're bundled instead of externalized
  transpilePackages: ['require-in-the-middle', 'import-in-the-middle'],
};

// Keeps @opentelemetry/api external, so autotel and every instrumentation
// share one copy whether Next bundles them or not.
export default withAutotelConfig(nextConfig);
