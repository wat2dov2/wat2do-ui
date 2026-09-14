import type { Metadata } from "next";
import { headers } from "next/headers";
import imgContactHero from "@/assets/contact_hero.png";
import { getPositionDirectorySnapshot } from "@/features/positions/api/positionDirectory.server";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { PositionsPage as PositionsPageContent } from "@/features/positions/pages/PositionsPage";
import { getSchool } from "@/shared/api/schools.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import {
  buildPublicPageMetadata,
  getSchoolCanonicalUrl,
  selectSeoImage,
} from "@/shared/lib/seo";

async function resolveRequestSchool(): Promise<string> {
  const requestHeaders = await headers();
  return getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

async function loadPositions(
  school: string,
): Promise<PaginatedPositionsResponse | null> {
  try {
    return await getPositionDirectorySnapshot(school);
  } catch (error) {
    console.error("Initial position directory fetch failed:", error);
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const school = await resolveRequestSchool();
  const [schoolRecord, directory] = await Promise.all([
    getSchool(school),
    loadPositions(school),
  ]);
  const schoolName = schoolRecord?.name ?? school;
  const title = `${schoolName} Student Club Positions | Wat2Do`;
  const description = `Find open executive, committee, volunteer, staff, and internship positions with student clubs at ${schoolName}.`;
  const featuredPosition = directory?.items.find(
    (position) => position.source_image_url,
  );

  return buildPublicPageMetadata({
    title,
    description,
    canonicalUrl: getSchoolCanonicalUrl(school, "/positions"),
    image: selectSeoImage(
      featuredPosition?.source_image_url,
      featuredPosition ? `${featuredPosition.title} position` : "",
      {
        url: imgContactHero.src,
        alt: `Discover student club positions at ${schoolName}`,
        width: imgContactHero.width,
        height: imgContactHero.height,
        type: "image/png",
      },
    ),
    index: Boolean(directory && directory.total > 0),
  });
}

export default async function PositionsPage() {
  const school = await resolveRequestSchool();
  const initialDirectory = await loadPositions(school);

  return (
    <PositionsPageContent
      initialDirectory={initialDirectory}
      initialSchool={school}
    />
  );
}
