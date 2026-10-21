"use client";

import { useTranslation } from "react-i18next";
import { LandingCard, LandingSection } from "@/features/landing/components/LandingSection";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Container, Stack } from "@/shared/layout";

const QUESTIONS = ["free", "clubs", "speed", "submit", "schools"] as const;

export function LandingFaq() {
  const { t } = useTranslation();
  const { schools } = useSchoolDirectory();

  return (
    <LandingSection eyebrow={t("landing.faq.eyebrow")} title={t("landing.faq.title")}>
      <Container size="md">
        <Stack gap={4}>
          {QUESTIONS.map((key) => (
            <LandingCard
              key={key}
              title={t(`landing.faq.items.${key}.question`)}
              description={t(`landing.faq.items.${key}.answer`, { count: schools.length })}
            />
          ))}
        </Stack>
      </Container>
    </LandingSection>
  );
}
