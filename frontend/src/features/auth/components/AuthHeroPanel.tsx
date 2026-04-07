import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard, type PreviewEventData } from "@/features/auth/components/PreviewStyleEventCard";
import { useEventsStore } from "@/features/events/store/events.store";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import type { Event } from "@/shared/types";
import type { TFunction } from "i18next";
import { getEventCategory } from "@/shared/utils/event";
import { HERO_CARD_PLACEHOLDER_HEIGHT } from "@/features/auth/constants";

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
    category: getEventCategory(event),
    image: event.imageUrl ?? event.source_image_url ?? "",
    date: formatCardDate(event, locale),
    time: formatCardTime(event),
    location: event.location ?? "",
    badges,
  };
}

export function AuthHeroPanel() {
  const { t, i18n } = useTranslation();

  // Read from store (same data as events page — no duplicate fetch)
  const allEvents = useEventsStore((s) => s.events);
  const loading = useEventsStore((s) => s.isLoading);

  const locale = i18n.language || "en-US";

  // Pick 4 random events for the hero panel (stable until events change)
  const previewEvents = useMemo(() => {
    if (allEvents.length === 0) return [];
    const shuffled = shuffle(allEvents);
    return shuffled.slice(0, 4).map((e) => eventToPreview(e, locale, t));
  }, [allEvents, locale, t]);

  return (
    <section className="hidden lg:flex flex-1 min-h-full bg-muted/30 border-l border-border px-8 py-10 justify-center items-center overflow-y-auto">
      <div className="w-full max-w-[480px]">
        {loading && (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl overflow-hidden bg-muted/60 animate-pulse"
                style={{ height: HERO_CARD_PLACEHOLDER_HEIGHT }}
              />
            ))}
          </div>
        )}
        {!loading && previewEvents.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {previewEvents.map((event, i) => (
              <PreviewStyleEventCard key={`${event.title}-${event.date}-${i}`} event={event} />
            ))}
          </div>
        )}
        {!loading && previewEvents.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No events right now.
          </p>
        )}
      </div>
    </section>
  );
}
