import { headers } from "next/headers";
import { EventRoutePage } from "@/app/event-route-page";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import type { SchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { getSchoolFromRequestHost } from "@/shared/constants/schools";

export const revalidate = 0;

async function loadInitialSnapshot(school: string): Promise<SchoolBrowseSnapshot | null> {
  try {
    return await getSchoolBrowseSnapshot(school);
  } catch (err) {
    console.error("Initial event feed fetch failed:", err);
    return null;
  }
}

/** Each school is served from its own subdomain, so the Host header scopes the feed. */
async function resolveRequestSchool(): Promise<string> {
  const requestHeaders = await headers();
  return getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

export default async function HomePage() {
  const school = await resolveRequestSchool();
  const snapshot = await loadInitialSnapshot(school);

  return <EventRoutePage initialSnapshot={snapshot} initialSchool={school} />;
}
