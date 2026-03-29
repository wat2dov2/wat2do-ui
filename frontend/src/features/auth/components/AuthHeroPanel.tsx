import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard, type PreviewEventData } from "@/features/auth/components/PreviewStyleEventCard";
import { fetchAllEvents } from "@/features/events/api/events.api";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import type { Event } from "@/shared/types";
import type { TFunction } from "i18next";
import { getEventCategory } from "@/shared/utils/event";

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
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetchAllEvents()
      .then((list) => {
        if (cancelled) return;
        const shuffled = shuffle(list);
        setEvents(shuffled.slice(0, 4));
      })
      .catch(() => {
        if (!cancelled) setError("failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = i18n.language || "en-US";
  const previewEvents = useMemo(
    () => events.map((e) => eventToPreview(e, locale, t)),
    [events, locale, t]
  );

  return (
    <section className="hidden lg:flex flex-1 min-h-full bg-muted/30 border-l border-border px-8 py-10 justify-center items-center overflow-y-auto">
      <div className="w-full max-w-[480px]">
        {loading && (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl overflow-hidden bg-muted/60 animate-pulse"
                style={{ height: 220 }}
              />
            ))}
          </div>
        )}
        {error && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Events couldn’t be loaded right now.
          </p>
        )}
        {!loading && !error && previewEvents.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {previewEvents.map((event, i) => (
              <PreviewStyleEventCard key={`${event.title}-${event.date}-${i}`} event={event} />
            ))}
          </div>
        )}
        {!loading && !error && previewEvents.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No events right now.
          </p>
        )}
      </div>
    </section>
  );
}
