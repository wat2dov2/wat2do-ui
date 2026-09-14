import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import { getSchoolCanonicalUrl } from "@/shared/lib/seo";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const school = getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/auth/",
        "/club-panel/",
        "/design-system",
        "/invite/",
        "/login",
        "/onboarding",
        "/club-panel/",
        "/settings",
      ],
    },
    sitemap: getSchoolCanonicalUrl(school, "/sitemap.xml"),
  };
}
