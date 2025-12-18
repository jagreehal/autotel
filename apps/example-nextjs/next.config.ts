import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Transpile these packages so they're bundled instead of externalized
  transpilePackages: [
    'require-in-the-middle',
    'import-in-the-middle',
  ],
};

export default nextConfig;
