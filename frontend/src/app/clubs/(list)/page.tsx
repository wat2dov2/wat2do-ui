import type { Metadata } from "next";
import { cache } from "react";
import { getClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import { ClubsPage as ClubsPageContent } from "@/features/clubs/pages/ClubsPage";
import { getSchoolShareImage } from "@/features/events/api/eventFeed.server";
import { getRequestSchool, getSchool } from "@/shared/api/schools.server";
import { buildSchoolPageMetadata } from "@/shared/lib/seo";

const loadInitialDirectory = cache(async (
  school: string,
): Promise<PaginatedClubsResponse | null> => {
  try {
    return await getClubDirectorySnapshot(school);
  } catch (err) {
    console.error("Initial club directory fetch failed:", err);
    return null;
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const school = await getRequestSchool();
  const [schoolRecord, directory] = await Promise.all([
    getSchool(school),
    loadInitialDirectory(school),
  ]);

  return buildSchoolPageMetadata({
    page: "clubs",
    school,
    schoolRecord,
    image: await getSchoolShareImage(schoolRecord),
    index: Boolean(directory && directory.total > 0),
  });
}

export default async function ClubsPage() {
  const school = await getRequestSchool();
  const initialDirectory = await loadInitialDirectory(school);

  return (
    <ClubsPageContent
      initialDirectory={initialDirectory}
      initialSchool={school}
    />
  );
}
