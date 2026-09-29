"use client";

import { useTranslation } from "react-i18next";

import { useRequestSchool } from "@/app/client-providers";
import { BusinessSupportForm } from "@/features/contact/components/BusinessSupportForm";
import { ROUTES } from "@/shared/constants/routes";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Container, PageHeader, Stack } from "@/shared/layout";

export function BusinessSupportPage() {
  const { t } = useTranslation();
  const requestSchool = useRequestSchool();
  const { schoolBySlug } = useSchoolDirectory();
  const school = schoolBySlug.get(requestSchool);
  const city = school?.city?.trim();

  return (
    <Container size="sm">
      <Stack gap={6}>
        <PageHeader
          back={{ href: ROUTES.EVENTS, label: t("events.allEvents") }}
          title={city
            ? t("contact.businessSupport.titleCity", { city })
            : t("contact.businessSupport.title")}
          description={t("contact.businessSupport.description")}
        />
        <BusinessSupportForm school={school} />
      </Stack>
    </Container>
  );
}
