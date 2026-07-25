import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EventCardBody } from "@/features/events/components/EventCard";
import { EventCardImage } from "@/features/events/components/EventCardImage";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { useEventBadges } from "@/features/events/hooks/useEventBadges";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { cn } from "@/shared/lib/utils";
import type { Event } from "@/shared/types";

interface EventFormPreviewProps {
  className?: string;
}

/** Stands in for the not-yet-saved event's id on the preview's occurrences. */
const PREVIEW_EVENT_ID = -1;

/**
 * Live preview of the grid card the event will become.
 *
 * It renders the real card's own image and body components against an event
 * assembled from the form, so the preview cannot drift from the feed.
 */
export function EventFormPreview({ className }: EventFormPreviewProps) {
  const { t, i18n } = useTranslation();
  const { formData, imagePreview, selectedOrganizationName } = useEventFormContext();

  const previewEvent = useMemo<Event>(() => {
    const now = new Date().toISOString();
    return {
      id: PREVIEW_EVENT_ID,
      title: formData.title || t("events.eventTitle"),
      location: formData.location,
      occurrences: formData.occurrences.map((occurrence, index) => ({
        id: occurrence.id ?? `preview-${index}`,
        event_id: PREVIEW_EVENT_ID,
        dtstart_utc: occurrence.dtstart_local,
        dtend_utc: occurrence.dtend_local || undefined,
        created_at: now,
      })),
      price: formData.price,
      food: formData.food,
      registration: formData.registration,
      source_image_url: imagePreview || null,
      category: formData.category || null,
      organization: selectedOrganizationName || null,
      cancelled: false,
      added_at: now,
    };
  }, [formData, imagePreview, selectedOrganizationName, t]);

  const badges = useEventBadges(previewEvent);

  const cardDate = useMemo(
    () => formatCardDate(previewEvent, i18n.language || "en-US"),
    [previewEvent, i18n.language],
  );

  const cardTime = useMemo(() => formatCardTime(previewEvent), [previewEvent]);

  return (
    <div
      className={cn(
        "min-h-0 w-[19rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-background/40 p-4",
        className,
      )}
    >
      <div className="mb-4">
        <span className="whitespace-nowrap text-sm font-semibold text-foreground">
          {t("forms.livePreview")}
        </span>
      </div>

      <article className="mx-auto flex w-full max-w-[16.5rem] flex-col rounded-xl">
        <EventCardImage event={previewEvent} variant="card" interactive={false} />
        <EventCardBody
          event={previewEvent}
          date={cardDate}
          time={cardTime}
          badges={badges}
          t={t}
        />
      </article>
    </div>
  );
}
