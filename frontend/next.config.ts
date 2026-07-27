import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const apiRewriteUrl = (process.env.API_REWRITE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const instagramCoverLogoSvg = readFileSync(
  fileURLToPath(
    new URL("./public/instagram-cover-logo.svg", import.meta.url),
  ),
  "utf8",
);
const rawPromoterProgram = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../backend/controlbox/promoter_program.json", import.meta.url),
    ),
    "utf8",
  ),
) as {
  enabled: boolean;
  rate_cents: number;
  landing_confirmation_seconds: number;
  quiet_poster_days: number;
  banner_dismissal_days: number;
  tos_version: string;
  discord_invite_url: string;
  approved_templates: Array<{
    id: string;
    name: string;
    asset_path: string;
    eligible_school: string;
    print_size: "us-letter";
    orientation: "portrait";
    qr_placement: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    preview_description: string;
    available_for_creation: boolean;
  }>;
};
const publicPromoterProgram = {
  enabled: rawPromoterProgram.enabled,
  rateCents: rawPromoterProgram.rate_cents,
  landingConfirmationSeconds:
    rawPromoterProgram.landing_confirmation_seconds,
  quietPosterDays: rawPromoterProgram.quiet_poster_days,
  bannerDismissalDays: rawPromoterProgram.banner_dismissal_days,
  tosVersion: rawPromoterProgram.tos_version,
  discordInviteUrl: rawPromoterProgram.discord_invite_url,
  approvedTemplates: rawPromoterProgram.approved_templates.map((template) => ({
    id: template.id,
    name: template.name,
    assetPath: template.asset_path,
    eligibleSchool: template.eligible_school,
    printSize: template.print_size,
    orientation: template.orientation,
    qrPlacement: template.qr_placement,
    previewDescription: template.preview_description,
    availableForCreation: template.available_for_creation,
  })),
};
const apiCollectionPaths = [
  "credits",
  "events",
  "instagram-publishing/batches",
  "organizations",
  "payouts",
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
  env: {
    NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG: instagramCoverLogoSvg,
    NEXT_PUBLIC_PROMOTER_PROGRAM: JSON.stringify(publicPromoterProgram),
  },
  // The slide renderer reads its fonts and the resvg wasm binary from disk at
  // request time, so dependency tracing cannot see them and the standalone
  // image would ship without them.
  outputFileTracingIncludes: {
    "/api/render-instagram-slide": [
      "./node_modules/@fontsource/inter/files/inter-latin-400-normal.woff",
      "./node_modules/@fontsource/inter/files/inter-latin-500-normal.woff",
      "./node_modules/@fontsource/inter/files/inter-latin-600-normal.woff",
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
