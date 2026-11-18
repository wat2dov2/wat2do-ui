import type { Metadata } from "next";

import { DataPolicyPage } from "@/features/legal/pages/DataPolicyPage";
import { ROUTES } from "@/shared/constants/routes";
import { buildPublicPageMetadata, getBrandCanonicalUrl } from "@/shared/lib/seo";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Data Policy | Wat2Do",
  description:
    "What personal information Wat2Do collects, why, who we share it with, how long we keep it, and how to see, fix or delete yours.",
  canonicalUrl: getBrandCanonicalUrl(ROUTES.DATA_POLICY),
});

export default function DataPolicyRoute() {
  return <DataPolicyPage />;
}
