import imageDelivery from "../backend/controlbox/image_delivery.json" with { type: "json" };
import type { NextConfig } from "next";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const apiRewriteUrl = (process.env.API_REWRITE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const instagramCoverLogoSvg = readFileSync(
  fileURLToPath(
    new URL("./public/instagram-cover-logo.svg", import.meta.url),
  ),
  "utf8",
);
const clubCategoryDoodleDirectory = fileURLToPath(
  new URL("./public/icons/club-categories/", import.meta.url),
);
const clubCategoryDoodleSvgs = Object.fromEntries(
  readdirSync(clubCategoryDoodleDirectory)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => [
      `/icons/club-categories/${file}`,
      readFileSync(
        fileURLToPath(
          new URL(
            `./public/icons/club-categories/${file}`,
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ]),
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
  payout_day_of_month: number;
  quiet_poster_days: number;
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
  payoutDayOfMonth: rawPromoterProgram.payout_day_of_month,
  quietPosterDays: rawPromoterProgram.quiet_poster_days,
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
  "discovery-queries",
  "events",
  "instagram-publishing/batches",
  "clubs",
  "payouts",
  "positions",
  "position-submissions",
  "qr",
  "reports",
  "going-events",
  "saved-clubs",
  "submissions",
  "users",
  "v1/saved-events",
];

const nextConfig: NextConfig = {
  experimental: { testProxy: process.env.PLAYWRIGHT_TEST === "1" },
  output: "standalone",
  images: {
    formats: [imageDelivery.optimized_format as "image/webp"],
    deviceSizes: imageDelivery.device_sizes,
    imageSizes: imageDelivery.image_sizes,
    qualities: [imageDelivery.quality],
    remotePatterns: [
      {
        protocol: "https",
        hostname: imageDelivery.optimized_remote_host,
        pathname: `${imageDelivery.optimized_remote_path}**`,
      },
    ],
  },
  env: {
    NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG: instagramCoverLogoSvg,
    NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS: JSON.stringify(
      clubCategoryDoodleSvgs,
    ),
    NEXT_PUBLIC_PROMOTER_PROGRAM: JSON.stringify(publicPromoterProgram),
  },
  // The slide renderer reads its fonts and the resvg wasm binary from disk at
  // request time, so dependency tracing cannot see them and the standalone
  // image would ship without them.
  outputFileTracingIncludes: {
    "/api/render-instagram-slide": [
      "./public/fonts/slides/Satoshi-400.ttf",
      "./public/fonts/slides/Satoshi-500.ttf",
      "./public/fonts/slides/Satoshi-600.ttf",
      "./public/fonts/slides/Satoshi-700.ttf",
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
  allowedDevOrigins: ["127.0.0.1", "localhost", "wat2do.localhost", "*.wat2do.localhost"],
};

export default nextConfig;
