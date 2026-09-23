import { revalidateTag } from "next/cache";
import { after, NextRequest, NextResponse } from "next/server";
import { eventDetailTag, eventFeedTag, getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { clubDirectoryTag } from "@/features/clubs/api/clubDirectory.server";
import { getPositionDirectorySnapshot, positionDirectoryTag } from "@/features/positions/api/positionDirectory.server";
import {
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
  // Event writes must be visible on the very next read, including hard refresh.
  revalidateTag(eventFeedTag(school), { expire: 0 });
  if (typeof body.event_id === "number" && Number.isSafeInteger(body.event_id) && body.event_id > 0) {
    revalidateTag(eventDetailTag(body.event_id), { expire: 0 });
  }
  revalidateTag(clubDirectoryTag(school), "max");
  revalidateTag(positionDirectoryTag(school), "max");
  revalidateTag(schoolBrandingTag(school), "max");
  revalidateTag(SCHOOL_DIRECTORY_TAG, "max");

  // Warm after invalidation finishes so the next visitor can use fresh cached data.
  // Separate tasks let either directory finish warming if the other fails.
  for (const warm of [getSchoolBrowseSnapshot, getPositionDirectorySnapshot]) {
    after(async () => {
      await warm(school);
    });
  }

  return NextResponse.json({ revalidated: true, school });
}
