import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRewriteUrl = (process.env.API_REWRITE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const repositoryRoot = path.dirname(fileURLToPath(new URL("../product-control.json", import.meta.url)));
const apiCollectionPaths = [
  "credits",
  "events",
  "instagram-publishing/batches",
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
  output: "standalone",
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  turbopack: {
    root: repositoryRoot,
  },
  generateBuildId: () => process.env.APP_VERSION || "development",
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
