import { EventRoutePage } from "@/app/event-route-page";
import { getEventFeedForSchool } from "@/features/events/api/eventFeed.server";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import { SCHOOL_SLUGS, isKnownSchool, resolveSchool } from "@/shared/constants/schools";

interface SchoolHomePageProps {
  params: Promise<{
    school: string;
  }>;
}

export const revalidate = 3600;
export const dynamicParams = true;

export function generateStaticParams() {
  return SCHOOL_SLUGS.map((school) => ({ school }));
}

async function loadInitialFeed(school: string): Promise<PaginatedEventsResponse | null> {
  try {
    return await getEventFeedForSchool(school);
  } catch (err) {
    console.error("Initial event feed fetch failed:", err);
    return null;
  }
}

export default async function SchoolHomePage({ params }: SchoolHomePageProps) {
  const { school: rawSchool } = await params;
  const school = resolveSchool(rawSchool);
  const feed = isKnownSchool(school) ? await loadInitialFeed(school) : null;

  return <EventRoutePage initialFeed={feed} initialSchool={school} />;
}
