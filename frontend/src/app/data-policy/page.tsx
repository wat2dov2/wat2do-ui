import type { Metadata } from "next";

import imgContactHero from "@/assets/contact_hero.png";
import { DataPolicyPage } from "@/features/legal/pages/DataPolicyPage";
import { ROUTES } from "@/shared/constants/routes";
import { buildPublicPageMetadata, getBrandCanonicalUrl } from "@/shared/lib/seo";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Data Policy | Wat2Do",
  description:
    "What personal information Wat2Do collects, why, who we share it with, how long we keep it, and how to see, fix or delete yours.",
  canonicalUrl: getBrandCanonicalUrl(ROUTES.DATA_POLICY),
  image: {
    url: imgContactHero.src,
    alt: "Wat2Do data policy",
    width: imgContactHero.width,
    height: imgContactHero.height,
    type: "image/png",
  },
});

export default function DataPolicyRoute() {
  return <DataPolicyPage />;
}
