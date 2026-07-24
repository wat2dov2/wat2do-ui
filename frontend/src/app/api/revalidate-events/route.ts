import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { eventFeedTag } from "@/features/events/api/eventFeed.server";
import { isKnownSchool, resolveSchool } from "@/shared/constants/schools";

interface RevalidateEventsRequest {
  school?: string;
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
  if (!isKnownSchool(school)) {
    return NextResponse.json({ error: "Unknown school" }, { status: 400 });
  }

  // The feed renders per-host at "/", so the tagged fetch cache is the only
  // thing to invalidate - there is no per-school path to revalidate.
  revalidateTag(eventFeedTag(school), "max");

  return NextResponse.json({ revalidated: true, school });
}
