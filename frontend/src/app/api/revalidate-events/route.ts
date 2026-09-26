import { after, NextRequest, NextResponse } from "next/server";
import { getSchoolDirectory } from "@/shared/api/schools.server";
import {
  queueDiscoveryRefresh,
  reconcileDiscoverySnapshots,
} from "@/app/discoveryRefresh.server";
import type { DiscoveryResource } from "@/shared/services/discoverySnapshotStore";

export const runtime = "nodejs";
const resources: DiscoveryResource[] = [
  "events",
  "positions",
  "clubs",
  "branding",
  "schools",
];

export async function POST(request: NextRequest) {
  const secret = process.env.EVENT_FEED_REVALIDATION_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production")
    return NextResponse.json(
      { error: "Revalidation unavailable" },
      { status: 503 },
    );
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.school !== "string" ||
    !Array.isArray(body.resources) ||
    !body.resources.length ||
    body.resources.some(
      (value: unknown) =>
        typeof value !== "string" ||
        !resources.includes(value as DiscoveryResource),
    ) ||
    Object.keys(body).some((key) => key !== "school" && key !== "resources")
  ) {
    return NextResponse.json(
      { error: "Invalid refresh request" },
      { status: 400 },
    );
  }
  const requested = [...new Set(body.resources)] as DiscoveryResource[];
  try {
    if (
      !(await getSchoolDirectory()).some(
        (school) => school.slug === body.school,
      )
    )
      return NextResponse.json({ error: "Unknown school" }, { status: 400 });
    // Only acknowledge durable dirty revisions. Background reconciliation owns completion.
    await queueDiscoveryRefresh(body.school, requested);
    after(() => reconcileDiscoverySnapshots());
    return NextResponse.json(
      { accepted: true, school: body.school, resources: requested },
      { status: 202 },
    );
  } catch (error) {
    console.error("discovery_invalidation_failed", {
      school: body.school,
      resources: requested,
      error,
    });
    return NextResponse.json(
      { error: "Refresh could not be recorded" },
      { status: 503 },
    );
  }
}
