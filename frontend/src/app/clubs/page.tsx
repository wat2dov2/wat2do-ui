import type { Metadata } from "next";
import { headers } from "next/headers";
import imgContactHero from "@/assets/contact_hero.png";
import { getClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import { ClubsPage as ClubsPageContent } from "@/features/clubs/pages/ClubsPage";
import { getSchool } from "@/shared/api/schools.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import {
  buildPublicPageMetadata,
  getSchoolCanonicalUrl,
  selectSeoImage,
} from "@/shared/lib/seo";

async function loadInitialDirectory(
  school: string,
): Promise<PaginatedClubsResponse | null> {
  try {
    return await getClubDirectorySnapshot(school);
  } catch (err) {
    console.error("Initial club directory fetch failed:", err);
    return null;
  }
}

async function resolveRequestSchool(): Promise<string> {
  const requestHeaders = await headers();
  return getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const school = await resolveRequestSchool();
  const [schoolRecord, directory] = await Promise.all([
    getSchool(school),
    loadInitialDirectory(school),
  ]);
  const schoolName = schoolRecord?.name ?? school;
  const title = `${schoolName} Student Clubs | Wat2Do`;
  const description = `Explore student clubs at ${schoolName}. Find communities, upcoming events, social links, and ways to get involved.`;
  const featuredClub = directory?.items.find(
    (club) => club.logo_url,
  );

  return buildPublicPageMetadata({
    title,
    description,
    canonicalUrl: getSchoolCanonicalUrl(school, "/clubs"),
    image: selectSeoImage(
      featuredClub?.logo_url,
      featuredClub
        ? `${featuredClub.club_name} logo`
        : "",
      {
        url: imgContactHero.src,
        alt: `Discover student clubs at ${schoolName}`,
        width: imgContactHero.width,
        height: imgContactHero.height,
        type: "image/png",
      },
    ),
    index: Boolean(directory && directory.total > 0),
  });
}

export default async function ClubsPage() {
  const school = await resolveRequestSchool();
  const initialDirectory = await loadInitialDirectory(school);

  return (
    <ClubsPageContent
      initialDirectory={initialDirectory}
      initialSchool={school}
    />
  );
}
