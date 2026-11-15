"use client";

import { useTranslation } from "react-i18next";

import { LegalDocument } from "@/features/legal/components/LegalDocument";
import { CLUB_PAYOUT_SCHOOLS, clubPayoutTermsValues } from "@/features/legal/lib/values";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

/** What Wat2Do pays clubs for the attendees they check in, and on what terms. */
export function ClubPayoutTermsPage() {
  const { i18n } = useTranslation();
  const { getSchoolName } = useSchoolDirectory();
  return (
    <LegalDocument
      name="clubPayoutTerms"
      values={clubPayoutTermsValues(i18n.language, CLUB_PAYOUT_SCHOOLS.map(getSchoolName))}
    />
  );
}
