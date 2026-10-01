import { NextRequest, NextResponse } from "next/server";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { getPositionDirectorySnapshot } from "@/features/positions/api/positionDirectory.server";
import { getClubDirectorySnapshot } from "@/features/clubs/api/clubDirectory.server";
import { getSchoolDirectory } from "@/shared/api/schools.server";

import controls from "../../../../../backend/controlbox/discovery_cache.json" with { type: "json" };

const readers = {
  events: getSchoolBrowseSnapshot,
  positions: getPositionDirectorySnapshot,
  clubs: getClubDirectorySnapshot,
};
export async function GET(request: NextRequest) {
  const start = performance.now();
  const resource = request.nextUrl.searchParams.get("resource");
  const school = request.nextUrl.searchParams.get("school");
  if (!resource || !Object.hasOwn(readers, resource) || !school) {
    return NextResponse.json(
      { error: "Unknown discovery resource or school" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    if (!(await getSchoolDirectory()).some((item) => item.slug === school))
      return NextResponse.json({ error: "Unknown school" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const snapshot = await readers[resource as keyof typeof readers](school);
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": `public, max-age=0, s-maxage=${controls.cdn_ttl_seconds}, stale-while-revalidate=${controls.worker_interval_seconds}`,
        "Server-Timing": `snapshot;dur=${(performance.now() - start).toFixed(1)}`,
        "X-Snapshot-Generated-At": String(snapshot.generated_at),
      },
    });
  } catch (error) {
    console.error("discovery_read_failed", { school, resource, error });
    return NextResponse.json(
      { error: "Discovery is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
