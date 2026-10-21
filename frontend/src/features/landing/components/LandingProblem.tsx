"use client";

import { Trans, useTranslation } from "react-i18next";
import { LandingMark } from "@/features/landing/components/LandingMarks";
import { LandingCard, LandingEyebrow, LandingIcon, LandingSection } from "@/features/landing/components/LandingSection";
import { Stack } from "@/shared/layout";
import { CalendarDays, EyeOff, Instagram, Moon, type LucideIcon } from "@/shared/ui/doodle-icons";
import { Highlighter } from "@/shared/ui/highlighter";

const PAIN_POINTS: readonly { key: string; icon: LucideIcon }[] = [
  { key: "buried", icon: EyeOff },
  { key: "scattered", icon: Instagram },
  { key: "late", icon: CalendarDays },
  { key: "quiet", icon: Moon },
];

/** Why students miss campus events, ending on the moment that started Wat2Do. */
export function LandingProblem({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <LandingSection
      eyebrow={t("landing.problem.eyebrow")}
      title={<Trans i18nKey="landing.problem.title" components={{ mark: <LandingMark kind="circle" tone="yellow" /> }} />}
      description={t("landing.problem.description", { school: schoolName })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {PAIN_POINTS.map(({ key, icon }) => (
          <LandingCard
            key={key}
            header={<LandingIcon icon={icon} />}
            title={t(`landing.problem.points.${key}.title`)}
            description={t(`landing.problem.points.${key}.description`)}
          />
        ))}
      </div>

      <figure className="mx-auto max-w-3xl">
        <Stack gap={5} align="center" className="text-center">
          <LandingEyebrow>{t("landing.problem.storyLabel")}</LandingEyebrow>
          <blockquote className="text-2xl font-semibold leading-snug text-balance text-foreground sm:text-3xl">
            {t("landing.problem.story")}{" "}
            <Highlighter action="underline" color="var(--destructive)" strokeWidth={2.5} isView>
              {t("landing.problem.storyOver")}
            </Highlighter>{" "}
            {t("landing.problem.storyEnd")}
          </blockquote>
          <figcaption className="text-muted-foreground">
            {t("landing.problem.signature")}
          </figcaption>
        </Stack>
      </figure>
    </LandingSection>
  );
}
