import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

function configuredSupabaseOrigin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const supabaseOrigin = configuredSupabaseOrigin();
const connectSources = [
  "'self'",
  "https://challenges.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://*.supabase.co",
  ...(supabaseOrigin ? [supabaseOrigin] : []),
  ...(!isProduction ? ["http:", "ws:"] : []),
];
const imageSources = [
  "'self'",
  "blob:",
  "data:",
  "https://*.supabase.co",
  ...(supabaseOrigin ? [supabaseOrigin] : []),
];
const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  "https://challenges.cloudflare.com",
  ...(!isProduction ? ["'unsafe-eval'"] : []),
];
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  `connect-src ${connectSources.join(" ")}`,
  "font-src 'self' data: https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src https://challenges.cloudflare.com",
  `img-src ${imageSources.join(" ")}`,
  "object-src 'none'",
  `script-src ${scriptSources.join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    externalDir: true,
    proxyClientMaxBodySize: "12mb",
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
