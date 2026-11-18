import type { Metadata } from "next";
import { BrandStructuredData } from "@/app/brand-structured-data";
import { AboutPage as AboutPageContent } from "@/features/contact/pages/AboutPage";
import { ROUTES } from "@/shared/constants/routes";
import {
  buildPublicPageMetadata,
  getBrandCanonicalUrl,
} from "@/shared/lib/seo";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "About Wat2Do, Every Campus Club Event in One Place",
  description:
    "Wat2Do tracks club events, free food, parties and club roles at universities in Canada and the US. Tony and Erica, two University of Waterloo students, run it.",
  canonicalUrl: getBrandCanonicalUrl(ROUTES.ABOUT),
});

export default function AboutPage() {
  return (
    <>
      <BrandStructuredData />
      <AboutPageContent />
    </>
  );
}
