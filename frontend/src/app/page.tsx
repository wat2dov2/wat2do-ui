import { EventRoutePage } from "@/app/event-route-page";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import type { SchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";

async function loadInitialSnapshot(school: string): Promise<SchoolBrowseSnapshot | null> {
  try {
    return await getSchoolBrowseSnapshot(school);
  } catch (err) {
    console.error("Initial event feed fetch failed:", err);
    return null;
  }
}

export default async function HomePage() {
  const snapshot = await loadInitialSnapshot(DEFAULT_SCHOOL);

  return <EventRoutePage initialSnapshot={snapshot} initialSchool={DEFAULT_SCHOOL} />;
}
