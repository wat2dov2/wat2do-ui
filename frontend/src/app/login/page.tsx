import { headers } from "next/headers";
import { LoginRoute } from "@/app/client-routes";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";
import type { Event } from "@/shared/types";

export const revalidate = 0;

async function loadPreviewEvents(school: string): Promise<Event[]> {
  try {
    const snapshot = await getSchoolBrowseSnapshot(school);
    return snapshot.feed.items;
  } catch (err) {
    console.error("Login preview feed fetch failed:", err);
    return [];
  }
}

export default async function LoginPage() {
  const requestHeaders = await headers();
  const school = getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const previewEvents = await loadPreviewEvents(school);

  return <LoginRoute previewEvents={previewEvents} />;
}
