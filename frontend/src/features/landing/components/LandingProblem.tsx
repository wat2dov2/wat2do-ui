"use client";

import { useTranslation } from "react-i18next";
import { LandingRuledGrid, LandingRuledItem, LandingSection } from "@/features/landing/components/LandingSection";
import { Stack } from "@/shared/layout";

const PAIN_POINTS = ["buried", "scattered", "late", "quiet"] as const;

/** Why students miss campus events, ending on the moment that started Wat2Do. */
export function LandingProblem({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <LandingSection
      title={t("landing.problem.title")}
      description={t("landing.problem.description", { school: schoolName })}
    >
      <LandingRuledGrid columns={2}>
        {PAIN_POINTS.map((key) => (
          <LandingRuledItem
            key={key}
            title={t(`landing.problem.points.${key}.title`)}
            description={t(`landing.problem.points.${key}.description`)}
          />
        ))}
      </LandingRuledGrid>

      {/* The founders' story is the page's one pull quote, set large on its own line of sight. */}
      <figure className="mx-auto max-w-3xl py-8 sm:py-16">
        <Stack gap={8} align="center" className="text-center">
          <blockquote className="text-[clamp(1.625rem,3.2vw,2.5rem)] leading-[1.25] font-normal tracking-[-0.02em] text-balance text-foreground">
            {t("landing.problem.story")} {t("landing.problem.storyOver")} {t("landing.problem.storyEnd")}
          </blockquote>
          <figcaption className="text-muted-foreground">
            {t("landing.problem.signature")}
          </figcaption>
        </Stack>
      </figure>
    </LandingSection>
  );
}
