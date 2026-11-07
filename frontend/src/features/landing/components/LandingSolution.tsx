"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LandingSnapshot } from "@/features/landing/api/landing.server";
import { LandingCard, LandingNotchLabel, LandingStage, type LandingNotchTone } from "@/features/landing/components/LandingCard";
import { ClubsPreview, FreeFoodPreview, RemindersPreview } from "@/features/landing/components/LandingPreviews";
import { LandingSection } from "@/features/landing/components/LandingSection";
import { useCountUp } from "@/features/landing/hooks/useCountUp";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { Stack } from "@/shared/layout";
import { Skeleton } from "@/shared/ui/skeleton";

interface StatProps {
  value: number;
  label: string;
  /** A notched word in the badge legend's colour, for a stat that has one. */
  badge?: { tone: LandingNotchTone; text: string };
}

/** A number counted from the school's feeds, counting up the first time it scrolls into view. */
function LandingStat({ value, label, badge }: StatProps) {
  const { i18n } = useTranslation();
  const { ref, value: shown } = useCountUp<HTMLParagraphElement>(value);
  return (
    <LandingCard corners={badge ? { "top-right": <LandingNotchLabel tone={badge.tone}>{badge.text}</LandingNotchLabel> } : undefined}>
      {/* Held to the card's foot, so figures line up across a row whether or not a card carries a badge. */}
      <Stack gap={2} className="h-full justify-end">
        {/* Large figures carry side bearing; the nudge lines the digit's edge up with the label below. */}
        <p ref={ref} className="-ml-[0.05em] text-4xl font-normal tracking-[-0.04em] tabular-nums text-foreground sm:text-6xl">
          {formatLandingCount(shown, i18n.language)}
        </p>
        <p className="text-sm text-muted-foreground sm:text-base">{label}</p>
      </Stack>
    </LandingCard>
  );
}

function LandingStatSkeleton() {
  return (
    <LandingCard>
      <Stack gap={2}>
        <Skeleton className="h-10 w-20 sm:h-14 sm:w-28" />
        <Skeleton className="h-5 w-full max-w-40" />
      </Stack>
    </LandingCard>
  );
}

function FeatureCopy({ featureKey, schoolName, size }: { featureKey: string; schoolName: string; size: "main" | "supporting" }) {
  const { t } = useTranslation();
  return (
    <Stack gap={size === "main" ? 5 : 2}>
      <h3 className={size === "main"
        ? "text-3xl font-medium leading-[1.08] tracking-[-0.03em] text-balance text-foreground sm:text-[2.75rem]"
        : "text-xl font-medium tracking-[-0.01em] text-balance text-foreground"}
      >
        {t(`landing.features.${featureKey}.title`)}
      </h3>
      <p className={size === "main" ? "max-w-md text-lg leading-relaxed text-pretty text-muted-foreground" : "leading-relaxed text-pretty text-muted-foreground"}>
        {t(`landing.features.${featureKey}.description`, { school: schoolName })}
      </p>
    </Stack>
  );
}

function SupportingFeature({ featureKey, schoolName, children }: { featureKey: string; schoolName: string; children: ReactNode }) {
  return (
    <Stack gap={5}>
      <LandingStage>{children}</LandingStage>
      <FeatureCopy featureKey={featureKey} schoolName={schoolName} size="supporting" />
    </Stack>
  );
}

/** How Wat2Do fixes discovery: six of this school's live numbers, then the app itself doing it with real data. */
export function LandingSolution({ schoolName, snapshot }: { schoolName: string; snapshot: LandingSnapshot | null }) {
  const { t } = useTranslation();
  const isLoading = !snapshot;
  const events = snapshot?.events ?? [];

  // Strongest first. A number its feed could not load is left out, never shown as zero.
  const stats: { key: string; count: number | null | undefined; label: (count: number) => string; badge?: StatProps["badge"] }[] = [
    { key: "upcoming", count: snapshot?.events?.length, label: (count) => t("landing.solution.stats.upcomingLabel", { count }), badge: { tone: "live", text: t("common.live") } },
    { key: "thisWeek", count: snapshot?.thisWeekCount, label: (count) => t("landing.solution.stats.thisWeekLabel", { count }) },
    { key: "new", count: snapshot?.newThisWeekCount, label: (count) => t("landing.solution.stats.newLabel", { count }), badge: { tone: "new", text: t("events.new") } },
    { key: "freeFood", count: snapshot?.freeFoodCount, label: (count) => t("landing.solution.stats.freeFoodLabel", { count }), badge: { tone: "free", text: t("common.free") } },
    { key: "clubs", count: snapshot?.clubCount, label: (count) => t("landing.solution.stats.clubsLabel", { count, school: schoolName }) },
    { key: "positions", count: snapshot?.positionCount, label: (count) => t("landing.solution.stats.positionsLabel", { count }) },
  ];
  const shown = stats.flatMap(({ count, ...stat }) => (typeof count === "number" ? [{ ...stat, count }] : []));

  return (
    <LandingSection
      title={t("landing.solution.title")}
      description={t("landing.solution.description")}
    >
      {isLoading || shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {isLoading
            ? stats.map(({ key }) => <LandingStatSkeleton key={key} />)
            // Keyed by count too, so a number that changes counts afresh.
            : shown.map(({ key, count, label, badge }) => <LandingStat key={`${key}:${count}`} value={count} label={label(count)} badge={badge} />)}
        </div>
      ) : null}

      <Stack gap={12} className="pt-8 sm:gap-16 sm:pt-16">
        {/* The main feature gets the room. */}
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <FeatureCopy featureKey="filters" schoolName={schoolName} size="main" />
          <LandingStage>
            <FreeFoodPreview events={events} isLoading={isLoading} />
          </LandingStage>
        </div>
        <div className="grid gap-x-4 gap-y-10 lg:grid-cols-2">
          <SupportingFeature featureKey="reminders" schoolName={schoolName}>
            <RemindersPreview events={events} isLoading={isLoading} />
          </SupportingFeature>
          <SupportingFeature featureKey="clubs" schoolName={schoolName}>
            <ClubsPreview clubs={snapshot?.previewClubs ?? []} isLoading={isLoading} />
          </SupportingFeature>
        </div>
      </Stack>
    </LandingSection>
  );
}
