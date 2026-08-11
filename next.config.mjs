/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // In Cloud Run / containerised builds, webpack's WASM hasher (xxhash64) fails
  // with "Cannot read properties of undefined (reading 'length')". Switching to
  // the native Node.js sha256 hasher avoids the WASM initialisation entirely.
  webpack: (config) => {
    config.output.hashFunction = "sha256";
    return config;
  },
  experimental: {
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
      "resend",
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
