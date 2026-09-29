import type { Metadata } from "next";

import imgContactHero from "@/assets/contact_hero.png";
import { BusinessSupportPage } from "@/features/contact/pages/BusinessSupportPage";
import { ROUTES } from "@/shared/constants/routes";
import { buildPublicPageMetadata, getBrandCanonicalUrl } from "@/shared/lib/seo";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Support a Local Business | Wat2Do",
  description: "Nominate a local business that could use support from students for a spot in the Wat2Do banner.",
  canonicalUrl: getBrandCanonicalUrl(ROUTES.SUPPORT_LOCAL),
  image: {
    url: imgContactHero.src,
    alt: "Wat2Do community support",
    width: imgContactHero.width,
    height: imgContactHero.height,
    type: "image/png",
  },
});

export default function SupportLocalPage() {
  return <BusinessSupportPage />;
}
