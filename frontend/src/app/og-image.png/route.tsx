import { ImageResponse } from "next/og";
import { getSchoolBrowseSnapshot } from "@/features/events/api/eventFeed.server";
import { SchoolShareImage } from "@/features/events/components/SchoolShareImage";
import { buildSchoolShareCard } from "@/features/events/lib/schoolShareCard";
import { getRequestSchool, getSchool } from "@/shared/api/schools.server";
import { controlBox } from "@/shared/config/controlBox";
import { buildInstagramCoverLogo } from "@/shared/lib/instagramCoverLogo";
import { loadImageFonts } from "@/shared/services/imageFonts.server";

export const runtime = "nodejs";

/**
 * The link preview of the requesting school's event feed. A route handler
 * rather than an `opengraph-image` file: the school comes from the request's
 * host, and the events page links here on that host with a version query.
 */
export async function GET() {
  const schoolRecord = await getSchool(await getRequestSchool());
  if (!schoolRecord) {
    return new Response("Unknown school", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const [snapshot, fonts] = await Promise.all([
    getSchoolBrowseSnapshot(schoolRecord.slug),
    loadImageFonts(),
  ]);
  const card = buildSchoolShareCard(schoolRecord, snapshot.items, Date.now());
  const { width, height, cacheMaxAgeSeconds } = controlBox.socialPreviews;
  return new ImageResponse(
    <SchoolShareImage card={card} logoSrc={buildInstagramCoverLogo(card.colors)} />,
    {
      width,
      height,
      fonts,
      headers: { "Cache-Control": `public, max-age=${cacheMaxAgeSeconds}` },
    },
  );
}
