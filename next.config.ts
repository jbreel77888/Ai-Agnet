import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow CommonJS modules like pg, drizzle-orm, etc.
  serverExternalPackages: ['pg', 'drizzle-orm', 'embedded-postgres', 'ioredis', 'bullmq', 'jsonwebtoken', 'pino'],
  // Empty turbopack config to silence warning
  turbopack: {},
};

export default nextConfig;
