import type { NextConfig } from "next";

const DEFAULT_API_REWRITE_URL = "https://wat2do-api-production.up.railway.app";
const apiRewriteUrl = (process.env.API_REWRITE_URL || DEFAULT_API_REWRITE_URL).replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiRewriteUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
