import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users, ImageOff } from "lucide-react";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { translateCategory, getCategoryClasses } from "@/shared/utils/event";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { computeEventBadges } from "@/features/events/hooks/useEventBadges";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

export function EventFormPreview() {
  const { t, i18n } = useTranslation();
  const { formData } = useEventFormContext();

  // Generate badges matching EventCard structure
  const previewBadgeStyles = useMemo(() => ({
    freeBg: "bg-success/20",
    freeText: "text-success",
    foodBg: "bg-warning/20",
    foodText: "text-warning",
  }), []);

  const badges = useMemo(
    () => computeEventBadges(formData, t, previewBadgeStyles),
    [formData.price, formData.food, formData.requiresRegistration, t, previewBadgeStyles],
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
              <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 flex items-center justify-center">
                <ImageOff className="w-8 h-8 text-muted-foreground/40" />
              </div>
            }
            placeholder={
              <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 animate-pulse" />
            }
          />
          
          {/* Category Badge - Top Left */}
          {formData.category && (
            <BadgeMask variant="top-left">
              <span
                className={`font-bold text-[10px] px-2 py-0.5 block rounded-full ${
                  getCategoryClasses(formData.category).bg
                } ${getCategoryClasses(formData.category).text}`}
              >
                {translateCategory(formData.category, t)}
              </span>
            </BadgeMask>
          )}

          {/* Club/Organization Badge - Bottom Left */}
          <BadgeMask variant="bottom-left">
            <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-background border border-foreground text-foreground flex items-center gap-1.5">
              <Users className="w-3 h-3" strokeWidth={2} />
              <span className="truncate max-w-[100px]">
                {formData.organization || t("events.organization")}
              </span>
            </span>
          </BadgeMask>
        </div>

        {/* Event Content */}
        <EventCardContent
          title={formData.title || t("events.eventTitle")}
          date={cardDate || undefined}
          time={cardTime || undefined}
          location={formData.location || undefined}
          badges={badges}
        />
      </article>

      <p className="text-[10px] text-muted-foreground text-center">
        {t("events.previewDescription")}
      </p>
    </div>
  );
}
