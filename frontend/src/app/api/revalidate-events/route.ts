import { revalidateTag } from "next/cache";
import { after, NextRequest, NextResponse } from "next/server";
import { eventDetailTag, eventFeedTag, getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { clubDirectoryTag, getClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import { getPositionDirectorySnapshot, positionDirectoryTag } from "@/features/positions/api/positionDirectory.server";
import {
  getSchool,
  getSchoolDirectory,
  SCHOOL_DIRECTORY_TAG,
  schoolBrandingTag,
} from "@/shared/api/schools.server";
import { resolveSchool } from "@/shared/constants/schools";

interface RevalidateEventsRequest {
  school?: string;
  event_id?: number;
  secret?: string;
}

export const runtime = "nodejs";

function getBearerSecret(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
}

async function readBody(request: NextRequest): Promise<RevalidateEventsRequest> {
  try {
    return (await request.json()) as RevalidateEventsRequest;
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.EVENT_FEED_REVALIDATION_SECRET?.trim();
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Revalidation secret is not configured" }, { status: 500 });
  }

  const body = await readBody(request);
  const providedSecret =
    getBearerSecret(request) ?? body.secret ?? request.nextUrl.searchParams.get("secret");

  if (configuredSecret && providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const school = resolveSchool(body.school ?? request.nextUrl.searchParams.get("school"));

  // Public discovery renders per-host, so tagged fetch caches are the only
  // school-specific surfaces to invalidate - there is no per-school pathname.
  if (typeof body.event_id === "number" && Number.isSafeInteger(body.event_id) && body.event_id > 0) {
    revalidateTag(eventDetailTag(body.event_id), { expire: 0 });
  }

  // Keep the previous snapshot available while its replacement warms.
  // Pair each tag with its loader so no invalidated directory is left cold.
  const snapshots = [
    { tag: eventFeedTag(school), warm: () => getSchoolBrowseSnapshot(school) },
    { tag: positionDirectoryTag(school), warm: () => getPositionDirectorySnapshot(school) },
    { tag: clubDirectoryTag(school), warm: () => getClubDirectorySnapshot(school) },
    { tag: schoolBrandingTag(school), warm: () => getSchool(school) },
    { tag: SCHOOL_DIRECTORY_TAG, warm: () => getSchoolDirectory() },
  ];
  for (const { tag, warm } of snapshots) {
    revalidateTag(tag, "max");
    // Independent tasks keep an upstream failure from skipping other snapshots.
    after(async () => { await warm(); });
  }

  return NextResponse.json({ revalidated: true, school });
}
