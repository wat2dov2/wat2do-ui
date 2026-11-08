"use client";

import { useTranslation } from "react-i18next";
import { LandingCard, LandingCardCopy } from "@/features/landing/components/LandingCard";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";

const QUESTIONS = ["free", "clubs", "speed", "submit", "schools"] as const;

/** Each question on its own card beside the heading, which stays in view while the answers scroll. */
export function LandingFaq() {
  const { t } = useTranslation();
  const { schools } = useSchoolDirectory();

  return (
    <section className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-24">
      <div className="lg:sticky lg:top-28 lg:self-start">
        <LandingHeading title={t("landing.faq.title")} />
      </div>
      <Stack gap={3}>
        {QUESTIONS.map((key) => (
          <LandingCard key={key}>
            <LandingCardCopy
              title={t(`landing.faq.items.${key}.question`)}
              description={t(`landing.faq.items.${key}.answer`, { count: schools.length })}
            />
          </LandingCard>
        ))}
      </Stack>
    </section>
  );
}
