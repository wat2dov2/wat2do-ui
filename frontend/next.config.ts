import type { NextConfig } from "next";

const DEFAULT_API_REWRITE_URL = "https://wat2do-api-production.up.railway.app";
const apiRewriteUrl = (process.env.API_REWRITE_URL || DEFAULT_API_REWRITE_URL).replace(/\/$/, "");
const apiCollectionPaths = [
  "credits",
  "events",
  "organizations",
  "promotions",
  "qr",
  "reports",
  "going-events",
  "saved-organizations",
  "submissions",
  "users",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      ...apiCollectionPaths.map((path) => ({
        source: `/api/${path}/`,
        destination: `${apiRewriteUrl}/${path}/`,
      })),
      {
        source: "/api/:path*",
        destination: `${apiRewriteUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
