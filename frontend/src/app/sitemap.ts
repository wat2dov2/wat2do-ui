import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { isEventIndexable } from "@/features/events/lib/eventSeo";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { getAllOrganizationDirectorySnapshot } from "@/features/organizations/api/organizationDirectory.server";
import { isOrganizationIndexable } from "@/features/organizations/lib/organizationSeo";
import { getPositionDirectorySnapshot } from "@/features/positions/api/positionDirectory.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import { organizationPagePath } from "@/shared/constants/routes";
import { getSchoolCanonicalUrl } from "@/shared/lib/seo";

export const dynamic = "force-dynamic";

function validLastModified(
  value: string | Date | null | undefined,
): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  const school = getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const rootUrl = getSchoolCanonicalUrl(school, "/");

  try {
    const [snapshot, organizations, positions] = await Promise.all([
      getSchoolBrowseSnapshot(school),
      getAllOrganizationDirectorySnapshot(school),
      getPositionDirectorySnapshot(school),
    ]);
    const eventEntries: MetadataRoute.Sitemap = snapshot.feed.items
      .filter(isEventIndexable)
      .map((event) => ({
        url: getSchoolCanonicalUrl(school, eventPagePath(event.id)),
        lastModified: validLastModified(event.added_at),
        changeFrequency: "daily",
        priority: 0.8,
      }));
    const organizationEntries: MetadataRoute.Sitemap = organizations
      .filter(isOrganizationIndexable)
      .map((organization) => ({
        url: getSchoolCanonicalUrl(
          school,
          organizationPagePath(organization.id),
        ),
        changeFrequency: "weekly",
        priority: 0.6,
      }));

    return [
      {
        url: rootUrl,
        lastModified: validLastModified(snapshot.feed.latest_added_event?.added_at),
        changeFrequency: "daily",
        priority: 1,
      },
      ...(organizations.length > 0
        ? [
            {
              url: getSchoolCanonicalUrl(school, "/organizations"),
              changeFrequency: "daily" as const,
              priority: 0.9,
            },
          ]
        : []),
      ...(positions.total > 0
        ? [
            {
              url: getSchoolCanonicalUrl(school, "/positions"),
              changeFrequency: "daily" as const,
              priority: 0.8,
            },
          ]
        : []),
      ...eventEntries,
      ...organizationEntries,
    ];
  } catch (error) {
    console.error("School sitemap generation failed:", error);
    return [{ url: rootUrl, changeFrequency: "daily", priority: 1 }];
  }
}
