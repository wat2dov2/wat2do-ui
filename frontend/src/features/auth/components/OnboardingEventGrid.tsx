/**
 * Onboarding event grid: 2×4 grid of event cards from Supabase.
 * Uses the same card style as the auth page right-side (hero) section.
 * User can multi-select (optional).
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard, type PreviewEventData } from "@/features/auth/components/PreviewStyleEventCard";
import { useEventsStore } from "@/features/events/store/events.store";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import type { Event } from "@/shared/types";
import type { TFunction } from "i18next";
import { cn } from "@/shared/lib/utils";

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function eventToPreview(event: Event, locale: string, t: TFunction): PreviewEventData {
  const badges: Array<{ text: string; bgClass: string; textClass: string }> = [];
  const price = event.price ?? 0;
  if (price === 0) {
    badges.push({ text: t("common.free"), bgClass: "bg-success/20", textClass: "text-success" });
  } else if (price != null) {
    badges.push({ text: `$${price}`, bgClass: "bg-primary/20", textClass: "text-primary" });
  }
  const food = event.food || [];
  if (food.length > 0) {
    badges.push({ text: t("common.freeFood"), bgClass: "bg-warning/20", textClass: "text-warning" });
  }
  const requiresRegistration = event.requiresRegistration ?? event.registration ?? false;
  if (requiresRegistration) {
    badges.push({
      text: t("common.registration"),
      bgClass: "bg-purple-500/20",
      textClass: "text-purple-500",
    });
  }

  return {
    title: event.title,
    org: event.organization ?? event.display_handle ?? "",
    category: event.category ?? "Events",
    image: event.imageUrl ?? event.source_image_url ?? "",
    date: formatCardDate(event, locale),
    time: formatCardTime(event),
    location: event.location ?? "",
    badges,
  };
}

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

  // Pick 8 random events for onboarding (stable until events change)
  const previewEvents = useMemo(() => {
    if (allEvents.length === 0) return [];
    const shuffled = shuffle(allEvents);
    return shuffled.slice(0, 8).map((e) => ({ event: e, preview: eventToPreview(e, locale, t) }));
  }, [allEvents, locale, t]);

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
            className="rounded-xl overflow-hidden bg-muted/60 animate-pulse"
            style={{ height: "220px" }}
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
        No events right now. You can continue without selecting.
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
      aria-label="Select events that catch your eye"
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
