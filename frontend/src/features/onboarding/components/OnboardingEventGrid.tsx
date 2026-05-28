/**
 * Onboarding event grid: 2×4 grid of event cards from Supabase.
 * Uses the same card style as the auth page right-side (hero) section.
 * User can multi-select (optional).
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  PreviewStyleEventCard,
  HERO_CARD_PLACEHOLDER_HEIGHT,
  eventToPreview,
  shuffle,
} from "@/features/auth";
import { useEventsStore } from "@/features/events";
import { cn } from "@/shared/lib/utils";

interface OnboardingEventGridProps {
  selectedEventIds: number[];
  onToggleEventId: (eventId: number) => void;
  className?: string;
}

export function OnboardingEventGrid({
  selectedEventIds,
  onToggleEventId,
  className,
}: OnboardingEventGridProps) {
  const { t, i18n } = useTranslation();

  // Read from store (same data as events page — no duplicate fetch)
  const allEvents = useEventsStore((s) => s.events);
  const loading = useEventsStore((s) => s.isLoading);

  const locale = i18n.language || "en-US";

  // Memoize the "pick top 8 random events" step so it only recomputes when
  // the underlying events array changes — not on every locale/translation
  // change. Documents intent: only the first 8 shuffled events are needed.
  const topEvents = useMemo(() => shuffle(allEvents).slice(0, 8), [allEvents]);

  const previewEvents = useMemo(
    () => topEvents.map((e) => ({ event: e, preview: eventToPreview(e, locale, t) })),
    [topEvents, locale, t],
  );

  if (loading) {
    return (
      <div
        className={cn(
          "grid grid-cols-2 gap-3 w-full max-w-2xl mx-auto min-h-[360px] place-content-start",
          className
        )}
        aria-busy
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl overflow-hidden bg-secondary/60 animate-pulse"
            style={{ height: HERO_CARD_PLACEHOLDER_HEIGHT }}
          />
        ))}
      </div>
    );
  }

  if (!loading && previewEvents.length === 0) {
    return (
      <div
        className={cn(
          "text-sm text-muted-foreground text-center py-8 max-w-md mx-auto",
          className
        )}
      >
        {t("onboarding.events.noEventsAvailable", "No events right now. You can continue without selecting.")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4 w-full max-w-2xl mx-auto",
        className
      )}
      role="list"
      aria-label={t("onboarding.events.selectAriaLabel", "Select events that catch your eye")}
    >
      {previewEvents.map(({ event, preview }) => {
        const isSelected = selectedEventIds.includes(event.id);
        return (
          <PreviewStyleEventCard
            key={event.id}
            event={preview}
            selected={isSelected}
            onClick={() => onToggleEventId(event.id)}
            data-event-id={event.id}
          />
        );
      })}
    </div>
  );
}
