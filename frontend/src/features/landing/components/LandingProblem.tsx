"use client";

import { useTranslation } from "react-i18next";
import { LandingCard, LandingCardCopy, LandingCardGrid } from "@/features/landing/components/LandingCard";
import { LandingSection } from "@/features/landing/components/LandingSection";

const PAIN_POINTS = ["buried", "scattered", "late", "quiet"] as const;

/** Why students miss campus events. */
export function LandingProblem({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <LandingSection
      title={t("landing.problem.title")}
      description={t("landing.problem.description", { school: schoolName })}
    >
      <LandingCardGrid columns={2}>
        {PAIN_POINTS.map((key) => (
          <LandingCard key={key}>
            <LandingCardCopy
              title={t(`landing.problem.points.${key}.title`)}
              description={t(`landing.problem.points.${key}.description`)}
            />
          </LandingCard>
        ))}
      </LandingCardGrid>
    </LandingSection>
  );
}
