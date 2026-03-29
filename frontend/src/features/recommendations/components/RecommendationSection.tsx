import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { useRecommendations } from "../hooks/useRecommendations";
import { EventCard } from "@/features/events/components/EventCard";
import type { Event } from "@/shared/types";

interface RecommendationSectionProps {
  events: Event[];
  savedEventIds: number[];
}

export function RecommendationSection({
  events,
  savedEventIds,
}: RecommendationSectionProps) {
  const { t } = useTranslation();
  const { recommendations, isLoading, error } = useRecommendations();

  if (error || (!isLoading && recommendations.length === 0)) {
    return null;
  }

  // Map recommendation event_ids to full Event objects
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const recommendedEvents = recommendations
    .map((rec) => {
      const event = eventsById.get(rec.event_id);
      return event ? { event, reason: rec.reason } : null;
    })
    .filter(Boolean) as { event: Event; reason: string }[];

  if (!isLoading && recommendedEvents.length === 0) {
    return null;
  }

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3 px-1">
        <Sparkles className="w-5 h-5 text-amber-500" />
        <h2 className="text-lg font-bold text-foreground">
          {t("events.recommendedForYou") || "Recommended For You"}
        </h2>
      </div>

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="min-w-[260px] h-[280px] rounded-xl bg-muted animate-pulse shrink-0"
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
          {recommendedEvents.map(({ event, reason }) => (
            <div
              key={event.id}
              className="min-w-[260px] max-w-[260px] shrink-0 flex flex-col"
            >
              <EventCard
                event={event}
                isSaved={savedEventIds.includes(event.id)}
              />
              <p className="text-xs text-muted-foreground mt-1.5 px-1 truncate">
                {reason}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
