import type { Metadata } from "next";

import { ClubPayoutTermsPage } from "@/features/legal/pages/ClubPayoutTermsPage";
import { ROUTES } from "@/shared/constants/routes";
import { buildPublicPageMetadata, getBrandCanonicalUrl } from "@/shared/lib/seo";

export const metadata: Metadata = buildPublicPageMetadata({
  title: "Club Payout Terms | Wat2Do",
  description:
    "How Wat2Do pays student clubs for each attendee they check in with free QR tickets: who can take part, which check-ins count, limits, payment and reviews.",
  canonicalUrl: getBrandCanonicalUrl(ROUTES.CLUB_PAYOUT_TERMS),
});

export default function ClubPayoutTermsRoute() {
  return <ClubPayoutTermsPage />;
}
