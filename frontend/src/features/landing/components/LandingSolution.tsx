"use client";

import type { ComponentType, ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { LandingSnapshot } from "@/features/landing/api/landing.server";
import { LandingMark } from "@/features/landing/components/LandingMarks";
import {
  CaptureMockup,
  ClubsMockup,
  FiltersMockup,
  RemindersMockup,
} from "@/features/landing/components/LandingMockups";
import { LandingEyebrow, LandingSection, LandingStage } from "@/features/landing/components/LandingSection";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { Stack } from "@/shared/layout";
import { Card, CardContent } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";

const SPLIT_FEATURES: readonly { key: string; Mockup: ComponentType }[] = [
  { key: "filters", Mockup: FiltersMockup },
  { key: "reminders", Mockup: RemindersMockup },
  { key: "clubs", Mockup: ClubsMockup },
];

/** A number counted live from the school's feeds; skeleton while they load. */
function LandingStat({ value, label }: { value: string | null; label: string }) {
  return (
    <Card>
      <CardContent>
        <Stack gap={1} align="center" className="text-center">
          {value === null ? (
            <Skeleton className="h-12 w-24" />
          ) : (
            <p className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{value}</p>
          )}
          <p className="text-muted-foreground">{label}</p>
        </Stack>
      </CardContent>
    </Card>
  );
}

function FeatureCopy({ featureKey, schoolName }: { featureKey: string; schoolName: string }) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <LandingEyebrow>{t(`landing.features.${featureKey}.eyebrow`)}</LandingEyebrow>
      <h3 className="text-2xl font-bold leading-tight tracking-tight text-balance text-foreground sm:text-4xl">
        {t(`landing.features.${featureKey}.title`)}
      </h3>
      <p className="text-lg text-pretty text-muted-foreground">
        {t(`landing.features.${featureKey}.description`, { school: schoolName })}
      </p>
    </Stack>
  );
}

/** One feature: its pitch on one side and the product doing it on the other. */
function LandingFeatureRow({ mirrored, copy, children }: { mirrored: boolean; copy: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
      <div className={cn(mirrored && "lg:order-2")}>{copy}</div>
      <LandingStage>{children}</LandingStage>
    </div>
  );
}

/** How Wat2Do fixes discovery: this school's live numbers, then each feature shown working. */
export function LandingSolution({ schoolName, snapshot }: { schoolName: string; snapshot: LandingSnapshot | null }) {
  const { t, i18n } = useTranslation();
  const count = (value: number | null | undefined) =>
    value === null || value === undefined ? null : formatLandingCount(value, i18n.language);

  return (
    <LandingSection
      eyebrow={t("landing.solution.eyebrow")}
      title={<Trans i18nKey="landing.solution.title" components={{ mark: <LandingMark kind="underline" tone="green" /> }} />}
      description={t("landing.solution.description")}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {/* A school whose club directory is unavailable shows the two event counts. */}
        {snapshot?.clubCount !== null ? (
          <LandingStat
            value={count(snapshot?.clubCount)}
            label={t("landing.solution.stats.clubsLabel", { count: snapshot?.clubCount ?? 0, school: schoolName })}
          />
        ) : null}
        <LandingStat
          value={count(snapshot?.events.length)}
          label={t("landing.solution.stats.upcomingLabel", { count: snapshot?.events.length ?? 0 })}
        />
        <LandingStat
          value={count(snapshot?.newThisWeekCount)}
          label={t("landing.solution.stats.newLabel", { count: snapshot?.newThisWeekCount ?? 0 })}
        />
      </div>

      <Stack gap={12} className="sm:gap-24">
        <LandingFeatureRow mirrored={false} copy={<FeatureCopy featureKey="capture" schoolName={schoolName} />}>
          <CaptureMockup />
        </LandingFeatureRow>
        {SPLIT_FEATURES.map(({ key, Mockup }, index) => (
          <LandingFeatureRow key={key} mirrored={index % 2 === 0} copy={<FeatureCopy featureKey={key} schoolName={schoolName} />}>
            <Mockup />
          </LandingFeatureRow>
        ))}
      </Stack>
    </LandingSection>
  );
}
