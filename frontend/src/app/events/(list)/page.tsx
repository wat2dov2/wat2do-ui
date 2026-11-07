import type { Metadata } from "next";
import { cache } from "react";
import { EventRoutePage } from "@/app/event-route-page";
import imgContactHero from "@/assets/contact_hero.png";
import {
  getEventFeedFirstScreen,
  getSchoolBrowseSnapshot,
} from "@/features/events/api/eventFeed.server";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import {
  buildSchoolShareCard,
  buildSchoolShareImage,
} from "@/features/events/lib/schoolShareCard";
import { getRequestSchool, getSchool } from "@/shared/api/schools.server";
import { ROUTES } from "@/shared/constants/routes";
import {
  buildPublicPageMetadata,
  getSchoolCanonicalUrl,
} from "@/shared/lib/seo";

export const revalidate = 0;

const loadInitialSnapshot = cache(async (
  school: string,
): Promise<PaginatedEventsResponse | null> => {
  try {
    return await getSchoolBrowseSnapshot(school);
  } catch (err) {
    console.error("Initial event feed fetch failed:", err);
    return null;
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const school = await getRequestSchool();
  const [schoolRecord, snapshot] = await Promise.all([
    getSchool(school),
    loadInitialSnapshot(school),
  ]);
  const schoolName = schoolRecord?.name ?? school;
  const title = `${schoolName} Events and Things to Do | Wat2Do`;
  const description = `Discover current events, activities, and things to do for students at ${schoolName}. Explore campus events by date, category, cost, and more.`;
  // The school's card needs its feed; without either, the generic hero stands in.
  const image =
    schoolRecord && snapshot
      ? buildSchoolShareImage(
          schoolRecord.slug,
          buildSchoolShareCard(schoolRecord, snapshot.items, Date.now()),
        )
      : {
          url: imgContactHero.src,
          alt: `Discover events and student life at ${schoolName} with Wat2Do`,
          width: imgContactHero.width,
          height: imgContactHero.height,
          type: "image/png",
        };

  return buildPublicPageMetadata({
    title,
    description,
    canonicalUrl: getSchoolCanonicalUrl(school, ROUTES.EVENTS),
    image,
    index: Boolean(snapshot && snapshot.items.length > 0),
  });
}

export default async function EventsPage() {
  const school = await getRequestSchool();
  const snapshot = await loadInitialSnapshot(school);
  const firstScreen = snapshot && await getEventFeedFirstScreen(snapshot, school);

  return <EventRoutePage firstScreen={firstScreen} initialSchool={school} />;
}
