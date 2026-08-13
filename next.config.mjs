/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloud Run / Replit builds have flaky webpack WASM (xxhash64) init. Prefer
  // Node's sha256 hasher, and keep the build on the main thread so a worker
  // crash cannot surface as Hash.update(undefined).
  webpack: (config) => {
    config.output.hashFunction = "sha256";
    config.output.hashDigest = "hex";
    return config;
  },
  experimental: {
    webpackBuildWorker: false,
    // The dashboard's server actions / route handlers import server-only packages.
    // Keep them external so Next never tries to bundle them into route code.
    serverComponentsExternalPackages: [
      "pg",
      "pg-boss",
      "bullmq",
      "ioredis",
      "playwright",
      "twilio",
      "googleapis",
      "@anthropic-ai/sdk",
      "stripe",
      "pdf-lib",
      "docx",
      "unpdf",
    ],
  },
  eslint: {
    // Lint is run explicitly; do not fail production builds on lint warnings.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
