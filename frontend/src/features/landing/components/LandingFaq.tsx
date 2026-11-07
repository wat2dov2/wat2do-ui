"use client";

import { useTranslation } from "react-i18next";
import { Clock, Gift, PenLine, School, Users, type LucideIcon } from "lucide-react";
import { LandingCard, LandingCardCopy, LandingNotchIcon } from "@/features/landing/components/LandingCard";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";

const QUESTIONS: readonly { key: string; icon: LucideIcon }[] = [
  { key: "free", icon: Gift },
  { key: "clubs", icon: Users },
  { key: "speed", icon: Clock },
  { key: "submit", icon: PenLine },
  { key: "schools", icon: School },
];

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
        {QUESTIONS.map(({ key, icon }) => (
          <LandingCard key={key} corners={{ "top-left": <LandingNotchIcon icon={icon} /> }}>
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
