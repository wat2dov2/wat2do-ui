import type { Metadata } from "next";
import imgContactHero from "@/assets/contact_hero.png";
import { getLandingSnapshot } from "@/features/landing/api/landing.server";
import { LandingPage } from "@/features/landing/pages/LandingPage";
import { getRequestSchool, getSchool } from "@/shared/api/schools.server";
import { ROUTES } from "@/shared/constants/routes";
import { buildPublicPageMetadata, getSchoolCanonicalUrl } from "@/shared/lib/seo";

export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const school = await getRequestSchool();
  // The title only needs a display name; an unreachable API must not take the page down.
  const schoolRecord = await getSchool(school).catch((error: unknown) => {
    console.error("Landing page school lookup failed:", error);
    return null;
  });
  const schoolName = schoolRecord?.name ?? school;

  return buildPublicPageMetadata({
    title: `Every ${schoolName} Event in One Feed | Wat2Do`,
    description: `Club events at ${schoolName} get buried across hundreds of Instagram accounts. Wat2Do finds them and puts every one in a single feed, minutes after clubs post.`,
    canonicalUrl: getSchoolCanonicalUrl(school, ROUTES.LANDING),
    image: {
      url: imgContactHero.src,
      alt: `Discover events and student life at ${schoolName} with Wat2Do`,
      width: imgContactHero.width,
      height: imgContactHero.height,
      type: "image/png",
    },
  });
}

export default async function LandingRoute() {
  return <LandingPage snapshot={await getLandingSnapshot(await getRequestSchool())} />;
}
