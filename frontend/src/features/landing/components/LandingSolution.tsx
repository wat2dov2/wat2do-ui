"use client";

import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, ScanText, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import type { LandingSnapshot } from "@/features/landing/api/landing.server";
import { LandingCard, LandingStage } from "@/features/landing/components/LandingCard";
import {
  CaptureMockup,
  ClubsMockup,
  FiltersMockup,
  RemindersMockup,
} from "@/features/landing/components/LandingMockups";
import { LandingSection } from "@/features/landing/components/LandingSection";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";

// In the order a student meets them: the event arrives, gets found, gets remembered, leads to its club.
const FEATURES: readonly { key: string; icon: LucideIcon; Mockup: ComponentType }[] = [
  { key: "capture", icon: ScanText, Mockup: CaptureMockup },
  { key: "filters", icon: SlidersHorizontal, Mockup: FiltersMockup },
  { key: "reminders", icon: BellRing, Mockup: RemindersMockup },
  { key: "clubs", icon: Users, Mockup: ClubsMockup },
];

/** A number counted live from the school's feeds; skeleton while they load. */
function LandingStat({ value, label, badge }: { value: string | null; label: string; badge?: ReactNode }) {
  return (
    <LandingCard corners={badge ? { "top-right": badge } : undefined}>
      <Stack gap={2}>
        {value === null ? (
          <Skeleton className="h-14 w-28" />
        ) : (
          <p className="text-6xl font-normal tracking-[-0.04em] tabular-nums text-foreground">{value}</p>
        )}
        <p className="text-muted-foreground">{label}</p>
      </Stack>
    </LandingCard>
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
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-24">
      <div className={cn(mirrored && "lg:order-2")}>{copy}</div>
      {children}
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
      {/* The counts wear the badges an event card would: Live for what's coming up, New for what just arrived. */}
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
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
          badge={<Badge variant="live" size="lg">{t("common.live")}</Badge>}
        />
        <LandingStat
          value={count(snapshot?.newThisWeekCount)}
          label={t("landing.solution.stats.newLabel", { count: snapshot?.newThisWeekCount ?? 0 })}
          badge={<Badge variant="new" size="lg">{t("events.new")}</Badge>}
        />
      </div>

      <Stack gap={12} className="pt-8 sm:gap-32 sm:pt-16">
        {FEATURES.map(({ key, icon, Mockup }, index) => (
          <LandingFeatureRow key={key} mirrored={index % 2 === 1} copy={<FeatureCopy featureKey={key} schoolName={schoolName} />}>
            <LandingStage icon={icon}>
              <Mockup />
            </LandingStage>
          </LandingFeatureRow>
        ))}
      </Stack>
    </LandingSection>
  );
}
