"use client";

import { useTranslation } from "react-i18next";
import { CalendarX, EyeOff, Shuffle, VolumeX, type LucideIcon } from "lucide-react";
import {
  LandingCard,
  LandingCardCopy,
  LandingCardGrid,
  LandingNotchIcon,
  LandingNotchLabel,
} from "@/features/landing/components/LandingCard";
import { LandingSection } from "@/features/landing/components/LandingSection";

const PAIN_POINTS: readonly { key: string; icon: LucideIcon }[] = [
  { key: "buried", icon: EyeOff },
  { key: "scattered", icon: Shuffle },
  { key: "late", icon: CalendarX },
  { key: "quiet", icon: VolumeX },
];

/** Why students miss campus events, ending on the moment that started Wat2Do. */
export function LandingProblem({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <LandingSection
      title={t("landing.problem.title")}
      description={t("landing.problem.description", { school: schoolName })}
    >
      <LandingCardGrid columns={2}>
        {PAIN_POINTS.map(({ key, icon }) => (
          <LandingCard key={key} corners={{ "top-left": <LandingNotchIcon icon={icon} /> }}>
            <LandingCardCopy
              title={t(`landing.problem.points.${key}.title`)}
              description={t(`landing.problem.points.${key}.description`)}
            />
          </LandingCard>
        ))}
      </LandingCardGrid>

      {/* The founders' story is the page's one pull quote, signed in the corner where an event card names its host. */}
      <LandingCard
        size="display"
        corners={{ "bottom-left": <LandingNotchLabel size="display">{t("landing.problem.signature")}</LandingNotchLabel> }}
      >
        <blockquote className="mx-auto max-w-3xl text-center text-[clamp(1.625rem,3.2vw,2.5rem)] leading-[1.25] font-normal tracking-[-0.02em] text-balance text-foreground">
          {t("landing.problem.story")} {t("landing.problem.storyOver")} {t("landing.problem.storyEnd")}
        </blockquote>
      </LandingCard>
    </LandingSection>
  );
}
