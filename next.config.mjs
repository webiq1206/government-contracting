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
  typescript: {
    /*
     * Off by default: `next build` type-checks, everywhere.
     *
     * The one exception is a deploy builder too memory-starved to run tsc
     * over this codebase (Replit's builder caps Node's heap near 2GB and the
     * check needs more; the build dies at "Checking validity of types" with
     * a heap OOM). Every commit is already type-checked twice before it can
     * deploy, `npm run typecheck` and a full `next build` both run in CI, so
     * on such a builder the in-build check is a redundant third pass. Set
     * DEPLOY_SKIP_TYPECHECK=1 on the deployment only, never locally and
     * never in CI, and prefer raising the heap (see .replit) when the
     * builder allows it.
     */
    ignoreBuildErrors: process.env.DEPLOY_SKIP_TYPECHECK === "1",
  },
  // Baseline security headers. Deliberately not a full CSP: that needs a
  // tested allowlist (Next inline runtime, Google Fonts, Stripe redirects)
  // and an untested CSP shipped at launch breaks pages in ways a missing one
  // does not. These four are safe everywhere and cover the common cases:
  // clickjacking, MIME sniffing, referrer leakage to third parties, and
  // never-needed browser capabilities.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS: once a browser has seen this, it refuses to talk to the
          // domain over plain HTTP for two years, closing the SSL-strip
          // downgrade window. Safe because the app is HTTPS-only in
          // production; harmless on localhost (browsers ignore HSTS without
          // TLS). includeSubDomains + preload so app.* and the apex are both
          // covered. Cheap to add, and the one security header most worth
          // having for a platform holding billing and gov-contracting data.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
