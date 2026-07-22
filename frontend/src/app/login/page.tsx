import { LoginRoute } from "@/app/client-routes";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import type { Event } from "@/shared/types";

async function loadPreviewEvents(): Promise<Event[]> {
  try {
    const snapshot = await getSchoolBrowseSnapshot(DEFAULT_SCHOOL);
    return snapshot.feed.items;
  } catch (err) {
    console.error("Login preview feed fetch failed:", err);
    return [];
  }
}

export default async function LoginPage() {
  const previewEvents = await loadPreviewEvents();

  return <LoginRoute previewEvents={previewEvents} />;
}
