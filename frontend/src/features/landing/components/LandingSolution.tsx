"use client";

import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LandingSnapshot } from "@/features/landing/api/landing.server";
import {
  CaptureMockup,
  ClubsMockup,
  FiltersMockup,
  RemindersMockup,
} from "@/features/landing/components/LandingMockups";
import { LandingSection, LandingStage } from "@/features/landing/components/LandingSection";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { Stack } from "@/shared/layout";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";

const SPLIT_FEATURES: readonly { key: string; Mockup: ComponentType }[] = [
  { key: "filters", Mockup: FiltersMockup },
  { key: "reminders", Mockup: RemindersMockup },
  { key: "clubs", Mockup: ClubsMockup },
];

/** A number counted live from the school's feeds, hung from a hairline; skeleton while they load. */
function LandingStat({ value, label }: { value: string | null; label: string }) {
  return (
    <Stack gap={2} className="border-t border-border pt-6">
      {value === null ? (
        <Skeleton className="h-14 w-28" />
      ) : (
        <p className="text-6xl font-normal tracking-[-0.04em] tabular-nums text-foreground">{value}</p>
      )}
      <p className="text-muted-foreground">{label}</p>
    </Stack>
  );
}

function FeatureCopy({ featureKey, schoolName }: { featureKey: string; schoolName: string }) {
  const { t } = useTranslation();
  return (
    <Stack gap={5}>
      <h3 className="text-3xl font-medium leading-[1.08] tracking-[-0.03em] text-balance text-foreground sm:text-[2.75rem]">
        {t(`landing.features.${featureKey}.title`)}
      </h3>
      <p className="max-w-md text-lg leading-relaxed text-pretty text-muted-foreground">
        {t(`landing.features.${featureKey}.description`, { school: schoolName })}
      </p>
    </Stack>
  );
}

/** One feature: its pitch on one side and the product doing it on the other. */
function LandingFeatureRow({ mirrored, copy, children }: { mirrored: boolean; copy: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-24">
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
      title={t("landing.solution.title")}
      description={t("landing.solution.description")}
    >
      <div className="grid gap-x-12 gap-y-8 sm:grid-cols-3">
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

      <Stack gap={12} className="pt-8 sm:gap-32 sm:pt-16">
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
