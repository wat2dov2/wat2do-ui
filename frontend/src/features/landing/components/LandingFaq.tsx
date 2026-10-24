"use client";

import { useTranslation } from "react-i18next";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";

const QUESTIONS = ["free", "clubs", "speed", "submit", "schools"] as const;

/** Questions as a ruled list beside their heading, which stays in view while the answers scroll. */
export function LandingFaq() {
  const { t } = useTranslation();
  const { schools } = useSchoolDirectory();

  return (
    <section className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-24">
      <div className="lg:sticky lg:top-28 lg:self-start">
        <LandingHeading title={t("landing.faq.title")} />
      </div>
      <dl className="border-b border-border">
        {QUESTIONS.map((key) => (
          <Stack key={key} gap={3} className="border-t border-border py-7">
            <dt className="text-xl font-medium tracking-[-0.01em] text-foreground">{t(`landing.faq.items.${key}.question`)}</dt>
            <dd className="max-w-prose leading-relaxed text-pretty text-muted-foreground">
              {t(`landing.faq.items.${key}.answer`, { count: schools.length })}
            </dd>
          </Stack>
        ))}
      </dl>
    </section>
  );
}
