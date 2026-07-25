import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const apiRewriteUrl = (process.env.API_REWRITE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
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
  // The slide renderer reads its fonts and the resvg wasm binary from disk at
  // request time, so dependency tracing cannot see them and the standalone
  // image would ship without them.
  outputFileTracingIncludes: {
    "/api/render-instagram-slide": [
      "./node_modules/@fontsource/inter/files/inter-latin-400-normal.woff",
      "./node_modules/@fontsource/inter/files/inter-latin-700-normal.woff",
      "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
    ],
  },
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
