import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PreviewStyleEventCard } from "@/features/auth/components/PreviewStyleEventCard";
import { useEventsStore } from "@/features/events";
import { HERO_CARD_PLACEHOLDER_HEIGHT } from "@/features/auth/constants";
import { eventToPreview } from "@/features/auth/utils/eventPreview";
import { shuffle } from "@/features/auth/utils/shuffle";

export function AuthHeroPanel() {
  const { t, i18n } = useTranslation();

  // Read from store (same data as events page — no duplicate fetch)
  const allEvents = useEventsStore((s) => s.events);
  const loading = useEventsStore((s) => s.isLoading);

  const locale = i18n.language || "en-US";

  // Memoize the "pick top 4 random events" step so it only recomputes when
  // the underlying events array changes — not on every locale/translation
  // change. Documents intent: only the first 4 shuffled events are needed.
  const topEvents = useMemo(() => shuffle(allEvents).slice(0, 4), [allEvents]);

  const previewEvents = useMemo(
    () => topEvents.map((e) => eventToPreview(e, locale, t)),
    [topEvents, locale, t],
  );

  return (
    <section className="hidden lg:flex flex-1 min-h-full bg-secondary/30 border-l border-border px-8 py-10 justify-center items-center overflow-y-auto">
      <div className="w-full max-w-[480px]">
        {loading && (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl overflow-hidden bg-secondary/60 animate-pulse"
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
            {t("onboarding.events.noEvents", "No events right now.")}
          </p>
        )}
      </div>
    </section>
  );
}
