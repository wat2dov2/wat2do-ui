import { EventRoutePage } from "@/app/event-route-page";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import type { SchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { isKnownSchool, resolveSchool } from "@/shared/constants/schools";

interface SchoolHomePageProps {
  params: Promise<{
    school: string;
  }>;
}

export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

async function loadInitialSnapshot(school: string): Promise<SchoolBrowseSnapshot | null> {
  try {
    return await getSchoolBrowseSnapshot(school);
  } catch (err) {
    console.error("Initial event feed fetch failed:", err);
    return null;
  }
}

export default async function SchoolHomePage({ params }: SchoolHomePageProps) {
  const { school: rawSchool } = await params;
  const school = resolveSchool(rawSchool);
  const snapshot = isKnownSchool(school) ? await loadInitialSnapshot(school) : null;

  return <EventRoutePage initialSnapshot={snapshot} initialSchool={school} />;
}
