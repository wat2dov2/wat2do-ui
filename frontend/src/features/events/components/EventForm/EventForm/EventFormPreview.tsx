import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { translateCategory, getCategoryClasses } from "@/shared/utils/event";
import { getEventCardWaterpaintStyle } from "@/shared/utils/eventCardWaterpaint";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { computeEventBadges } from "@/features/events/hooks/useEventBadges";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

export function EventFormPreview() {
  const { t, i18n } = useTranslation();
  const { formData } = useEventFormContext();
  const categoryClasses = getCategoryClasses(formData.category);

  // Generate badges matching EventCard structure
  const badges = useMemo(
    () => computeEventBadges(formData, t),
    [formData, t],
  );

  // Format date and time for preview (matching EventCard format)
  const cardDate = useMemo(
    () => formatCardDate({ dtstart_utc: formData.date || undefined }, i18n.language || 'en-US'),
    [formData.date, i18n.language],
  );

  const cardTime = useMemo(
    () => formatCardTime({ time: formData.time || undefined }),
    [formData.time],
  );

  return (
    <div className="w-80 border-l border-border p-6 overflow-y-auto min-h-0 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {t("forms.livePreview")}
        </span>
      </div>

      {/* Preview Card - Matches EventCard styling exactly */}
      <article
        className="rounded-xl overflow-hidden flex flex-col bg-card"
      >
        {/* Event Image */}
        <div className="relative overflow-hidden" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
          {/* Background - using LazyImage with fallback */}
          <LazyImage
            src=""
            alt={formData.title || t("events.eventTitle")}
            className="absolute inset-0 w-full h-full"
            fallback={
              <div className={`absolute inset-0 ${categoryClasses.bg} flex items-center justify-center`}>
                <ImageOff className={`size-8 ${categoryClasses.text} opacity-40`} />
              </div>
            }
            placeholder={
              <div className={`absolute inset-0 ${categoryClasses.bg} animate-pulse`} />
            }
          />
          
          {/* Category Badge - Top Left */}
          {formData.category && (
            <BadgeMask variant="top-left">
              <span
                className={`font-bold text-[10px] px-2 py-0.5 block rounded-full ${
                  categoryClasses.bg
                } ${categoryClasses.text}`}
              >
                {translateCategory(formData.category, t)}
              </span>
            </BadgeMask>
          )}

          {/* Club/Organization Badge - Bottom Left */}
          <BadgeMask variant="bottom-left">
            <span className="text-[10px] tracking-normal px-1.5 py-px rounded-full bg-background border border-foreground text-foreground flex items-center">
              <span className="truncate max-w-[128px]">
                {formData.organization || t("events.organization")}
              </span>
            </span>
          </BadgeMask>
        </div>

        <div
          className={`event-card-waterpaint flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden ${categoryClasses.bg} ${categoryClasses.text} ${categoryClasses.border}`}
          style={getEventCardWaterpaintStyle(`${formData.category}-${formData.title || "preview"}`)}
        >
          <EventCardContent
            title={formData.title || t("events.eventTitle")}
            date={cardDate || undefined}
            time={cardTime || undefined}
            location={formData.location || undefined}
            badges={badges}
            textClassName={categoryClasses.text}
            secondaryTextClassName={categoryClasses.text}
            badgeClassName={`border-current ${categoryClasses.text}`}
          />
        </div>
      </article>

      <p className="text-[10px] text-muted-foreground text-center">
        {t("events.previewDescription")}
      </p>
    </div>
  );
}
