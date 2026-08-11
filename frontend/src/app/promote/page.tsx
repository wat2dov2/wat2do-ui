import type { Metadata } from "next";
import imgContactHero from "@/assets/contact_hero.png";
import { PromotePage as PromotePageContent } from "@/features/posters/pages/PromotePage";
import {
  buildPublicPageMetadata,
  getBrandCanonicalUrl,
} from "@/shared/lib/seo";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Promote Wat2Do on Campus | Student Promoter Program",
  description:
    "Help more students discover campus events by promoting Wat2Do at your school. Learn how the student promoter program works and how to join.",
  canonicalUrl: getBrandCanonicalUrl("/promote"),
  image: {
    url: imgContactHero.src,
    alt: "Promote Wat2Do campus event discovery at your school",
    width: imgContactHero.width,
    height: imgContactHero.height,
    type: "image/png",
  },
});

export default function PromotePage() {
  return <PromotePageContent />;
}
