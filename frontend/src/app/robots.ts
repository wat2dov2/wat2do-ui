import type { MetadataRoute } from "next";
import { getRequestSchool } from "@/shared/api/schools.server";

import { getSchoolCanonicalUrl } from "@/shared/lib/seo";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const school = await getRequestSchool();

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
