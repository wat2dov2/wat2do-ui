import type { Metadata } from "next";
import { cache } from "react";
import { BrandStructuredData } from "@/app/brand-structured-data";
import { EventRoutePage } from "@/app/event-route-page";
import {
  getEventFeedFirstScreen,
  getSchoolBrowseSnapshot,
  getSchoolShareImage,
} from "@/features/events/api/eventFeed.server";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { getRequestSchool, getSchool } from "@/shared/api/schools.server";
import { buildSchoolPageMetadata } from "@/shared/lib/seo";

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

  return buildSchoolPageMetadata({
    page: "events",
    school,
    schoolRecord,
    image: await getSchoolShareImage(schoolRecord),
    index: Boolean(snapshot && snapshot.items.length > 0),
  });
}

export default async function EventsPage() {
  const school = await getRequestSchool();
  const snapshot = await loadInitialSnapshot(school);
  const firstScreen = snapshot && await getEventFeedFirstScreen(snapshot, school);

  // The root opens this page, so it carries the brand's home page data.
  return (
    <>
      <BrandStructuredData />
      <EventRoutePage firstScreen={firstScreen} initialSchool={school} />
    </>
  );
}
