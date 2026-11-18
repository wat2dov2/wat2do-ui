import type { Metadata } from "next";
import { getSchoolShareImage } from "@/features/events/api/eventFeed.server";
import { getLandingSnapshot } from "@/features/landing/api/landing.server";
import { LandingPage } from "@/features/landing/pages/LandingPage";
import { getRequestSchool, getSchool } from "@/shared/api/schools.server";
import { buildSchoolPageMetadata } from "@/shared/lib/seo";

export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const school = await getRequestSchool();
  // The title only needs a display name; an unreachable API must not take the page down.
  const schoolRecord = await getSchool(school).catch((error: unknown) => {
    console.error("Landing page school lookup failed:", error);
    return null;
  });

  return buildSchoolPageMetadata({
    page: "landing",
    school,
    schoolRecord,
    image: await getSchoolShareImage(schoolRecord),
  });
}

export default async function LandingRoute() {
  return <LandingPage snapshot={await getLandingSnapshot(await getRequestSchool())} />;
}
