import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import imgContactHero from "@/assets/contact_hero.png";
import { getClubEventsSnapshot } from "@/features/events/api/eventFeed.server";
import { getClubPositionsSnapshot } from "@/features/positions/api/positionDirectory.server";
import { getClubDetailSnapshot } from "@/features/clubs/api/clubDirectory.server";
import { isClubIndexable } from "@/features/clubs/lib/clubSeo";
import { ClubDetailsPage as ClubDetailsPageContent } from "@/features/clubs/pages/ClubDetailsPage";
import { ClubEventsGrid } from "@/features/events/components/ClubEventsGrid";
import { ClubPositionsGrid, ClubPositionsGridSkeleton } from "@/features/positions/components/ClubPositionsGrid";
import { getSchool } from "@/shared/api/schools.server";
import { clubPagePath } from "@/shared/constants/routes";
import {
  buildNoIndexPageMetadata,
  buildPublicPageMetadata,
  getSchoolCanonicalUrl,
  isCanonicalProductionHost,
  selectSeoImage,
} from "@/shared/lib/seo";
import type { Club, Event } from "@/shared/types";

const loadDetailSnapshot = cache(getClubDetailSnapshot);

interface ClubDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

function parseClubId(value: string): number | null {
  const clubId = Number(value);
  return Number.isInteger(clubId) && clubId > 0
    ? clubId
    : null;
}

async function loadClub(
  clubId: number,
): Promise<Club | null> {
  try {
    return await loadDetailSnapshot(clubId);
  } catch (error) {
    console.error("Club SEO detail fetch failed:", error);
    return null;
  }
}

/**
 * The club's events, read with the club so the page is revealed in one piece.
 * Streamed behind their own boundary, they drew the header over a screen of
 * placeholder cards that then collapsed to the club's real count. Without them
 * the grid fetches on mount.
 */
async function loadClubEvents(club: Club): Promise<Event[] | undefined> {
  try {
    return await getClubEventsSnapshot(club.id, club.school);
  } catch (error) {
    console.error("Club events fetch failed:", error);
    return undefined;
  }
}

/** Positions sit behind their tab, out of sight, so they stream in behind their own boundary. */
async function ClubPositions({ club }: { club: Club }) {
  const initialPositions = await getClubPositionsSnapshot(club.id, club.school);
  return <ClubPositionsGrid clubId={club.id} school={club.school} initialPositions={initialPositions} />;
}

export async function generateMetadata({
  params,
}: ClubDetailsPageProps): Promise<Metadata> {
  const { id } = await params;
  const clubId = parseClubId(id);
  const club = clubId
    ? await loadClub(clubId)
    : null;
  const fallbackImage = {
    url: imgContactHero.src,
    alt: "Discover student clubs with Wat2Do",
    width: imgContactHero.width,
    height: imgContactHero.height,
    type: "image/png",
  };

  if (!club || club.status !== "approved") {
    return buildNoIndexPageMetadata({
      title: "Club Not Found | Wat2Do",
      description: "This Wat2Do club could not be found.",
      image: fallbackImage,
    });
  }

  const schoolRecord = await getSchool(club.school);
  const schoolName = schoolRecord?.name ?? club.school;
  const title = `${club.club_name} Events and Positions at ${schoolName} | Wat2Do`;
  const categoryText = club.categories.join(", ");
  const description = `Explore ${club.club_name} at ${schoolName}${categoryText ? `, a student club focused on ${categoryText}` : ""}. Find upcoming events, open positions, and verified ways to connect.`;

  return buildPublicPageMetadata({
    title,
    description,
    canonicalUrl: getSchoolCanonicalUrl(
      club.school,
      clubPagePath(club.id),
    ),
    image: selectSeoImage(
      club.logo_url,
      `${club.club_name} logo`,
      fallbackImage,
    ),
    index: isClubIndexable(club),
  });
}

export default async function ClubDetailsPage({
  params,
}: ClubDetailsPageProps) {
  const { id } = await params;
  const clubId = parseClubId(id);
  if (!clubId) notFound();

  const club = await loadDetailSnapshot(clubId);
  if (!club || club.status !== "approved") notFound();

  const canonicalUrl = getSchoolCanonicalUrl(
    club.school,
    clubPagePath(club.id),
  );
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!isCanonicalProductionHost(requestHost, canonicalUrl)) {
    permanentRedirect(canonicalUrl);
  }

  const [schoolRecord, initialEvents] = await Promise.all([
    getSchool(club.school),
    loadClubEvents(club),
  ]);
  return (
    <ClubDetailsPageContent
      clubId={club.id}
      initialClub={club}
      schoolName={schoolRecord?.name ?? club.school}
      events={<ClubEventsGrid clubId={club.id} school={club.school} initialEvents={initialEvents} />}
      positions={
        <Suspense fallback={<ClubPositionsGridSkeleton />}>
          <ClubPositions club={club} />
        </Suspense>
      }
    />
  );
}
