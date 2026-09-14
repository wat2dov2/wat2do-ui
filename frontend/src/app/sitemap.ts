import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { isEventIndexable } from "@/features/events/lib/eventSeo";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { getAllClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import { isClubIndexable } from "@/features/clubs/lib/clubSeo";
import { getPositionDirectorySnapshot } from "@/features/positions/api/positionDirectory.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import { clubPagePath } from "@/shared/constants/routes";
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
    const [snapshot, clubs, positions] = await Promise.all([
      getSchoolBrowseSnapshot(school),
      getAllClubDirectorySnapshot(school),
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
    const clubEntries: MetadataRoute.Sitemap = clubs
      .filter(isClubIndexable)
      .map((club) => ({
        url: getSchoolCanonicalUrl(
          school,
          clubPagePath(club.id),
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
      ...(clubs.length > 0
        ? [
            {
              url: getSchoolCanonicalUrl(school, "/clubs"),
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
      ...clubEntries,
    ];
  } catch (error) {
    console.error("School sitemap generation failed:", error);
    return [{ url: rootUrl, changeFrequency: "daily", priority: 1 }];
  }
}
