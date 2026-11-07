"use client";

import { useMemo, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { EventCard, EventCardSkeleton } from "@/features/events";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import type { LandingSnapshot } from "@/features/landing/api/landing.server";
import { EventPixelMosaic } from "@/features/landing/components/EventPixelMosaic";
import { LandingCard, LandingStage } from "@/features/landing/components/LandingCard";
import { ClubsMockup, FiltersMockup, RemindersMockup } from "@/features/landing/components/LandingMockups";
import { LandingSection } from "@/features/landing/components/LandingSection";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { Stack } from "@/shared/layout";
import { Skeleton } from "@/shared/ui/skeleton";
import type { Event } from "@/shared/types";

// The supporting features, in the order a student meets them: found, remembered, then its club.
const SUPPORTING_FEATURES: readonly { key: string; Mockup: ComponentType }[] = [
  { key: "filters", Mockup: FiltersMockup },
  { key: "reminders", Mockup: RemindersMockup },
  { key: "clubs", Mockup: ClubsMockup },
];

/** A number counted live from the school's feeds; skeleton while they load. */
function LandingStat({ value, label }: { value: string | null; label: string }) {
  return (
    <LandingCard>
      <Stack gap={2}>
        {value === null ? (
          <Skeleton className="h-14 w-28" />
        ) : (
          // Large figures carry side bearing; the nudge lines the digit's edge up with the label below.
          <p className="-ml-[0.05em] text-6xl font-normal tracking-[-0.04em] tabular-nums text-foreground">{value}</p>
        )}
        <p className="text-muted-foreground">{label}</p>
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

/** The newest event in the feed that has a poster: proof that a club's post just became a listing. */
function newestPosterEvent(events: readonly Event[]): Event | null {
  return events.reduce<Event | null>((newest, event) => {
    if (!event.source_image_url || !event.added_at) return newest;
    return !newest || (newest.added_at ?? "") < event.added_at ? event : newest;
  }, null);
}

/** How Wat2Do fixes discovery: this school's live numbers, the main feature shown with a real event, then the rest. */
export function LandingSolution({ schoolName, snapshot }: { schoolName: string; snapshot: LandingSnapshot | null }) {
  const { t, i18n } = useTranslation();
  const count = (value: number | null | undefined) =>
    value === null || value === undefined ? null : formatLandingCount(value, i18n.language);
  const latest = useMemo(() => newestPosterEvent(snapshot?.events ?? []), [snapshot]);

  return (
    <LandingSection
      title={t("landing.solution.title")}
      description={t("landing.solution.description")}
    >
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
        />
        <LandingStat
          value={count(snapshot?.newThisWeekCount)}
          label={t("landing.solution.stats.newLabel", { count: snapshot?.newThisWeekCount ?? 0 })}
        />
      </div>

      <Stack gap={12} className="pt-8 sm:gap-16 sm:pt-16">
        {/* The main feature gets the room: the real card of the newest event a club posted, over the posters already read. */}
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <FeatureCopy featureKey="capture" schoolName={schoolName} size="main" />
          <LandingStage face={<EventPixelMosaic variant="ambient" />}>
            {/* An event card's natural width in the feed grid. */}
            <div className="w-64 py-6">
              {latest ? <EventCard event={latest} titleHref={eventPagePath(latest.id)} imagePriority={false} /> : <EventCardSkeleton />}
            </div>
          </LandingStage>
        </div>

        <div className="grid gap-x-4 gap-y-10 lg:grid-cols-3">
          {SUPPORTING_FEATURES.map(({ key, Mockup }) => (
            <Stack key={key} gap={5}>
              <LandingStage>
                <Mockup />
              </LandingStage>
              <FeatureCopy featureKey={key} schoolName={schoolName} size="supporting" />
            </Stack>
          ))}
        </div>
      </Stack>
    </LandingSection>
  );
}
