import type { Metadata } from "next";
import { cache } from "react";
import { getSchoolShareImage } from "@/features/events/api/eventFeed.server";
import { getPositionDirectorySnapshot } from "@/features/positions/api/positionDirectory.server";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { PositionsPage as PositionsPageContent } from "@/features/positions/pages/PositionsPage";
import { getRequestSchool, getSchool } from "@/shared/api/schools.server";
import { buildSchoolPageMetadata } from "@/shared/lib/seo";

const loadPositions = cache(async (
  school: string,
): Promise<PaginatedPositionsResponse | null> => {
  try {
    return await getPositionDirectorySnapshot(school);
  } catch (error) {
    console.error("Initial position directory fetch failed:", error);
    return null;
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const school = await getRequestSchool();
  const [schoolRecord, directory] = await Promise.all([
    getSchool(school),
    loadPositions(school),
  ]);

  return buildSchoolPageMetadata({
    page: "positions",
    school,
    schoolRecord,
    image: await getSchoolShareImage(schoolRecord),
    index: Boolean(directory && directory.total > 0),
  });
}

export default async function PositionsPage() {
  const school = await getRequestSchool();
  const initialDirectory = await loadPositions(school);

  return (
    <PositionsPageContent
      initialDirectory={initialDirectory}
      initialSchool={school}
    />
  );
}
