import type { Metadata } from "next";
import imgSchoolVisit from "@/assets/utsg-university-college.webp";
import { AboutPage as AboutPageContent } from "@/features/contact/pages/AboutPage";
import { ROUTES } from "@/shared/constants/routes";
import {
  buildPublicPageMetadata,
  getBrandCanonicalUrl,
} from "@/shared/lib/seo";

const title = "About Wat2Do | Campus Event Discovery";
const description =
  "Learn how Wat2Do's student founders built an Instagram event discovery system that has captured more than 3,000 University of Waterloo events since August 2025.";

export const metadata: Metadata = buildPublicPageMetadata({
  title,
  description,
  canonicalUrl: getBrandCanonicalUrl(ROUTES.ABOUT),
  image: {
    url: imgSchoolVisit.src,
    alt: "Meet the Wat2Do campus event discovery team",
    width: imgSchoolVisit.width,
    height: imgSchoolVisit.height,
    type: "image/webp",
  },
});

export default function AboutPage() {
  return <AboutPageContent />;
}
