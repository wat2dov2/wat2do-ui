import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users, ImageOff } from "lucide-react";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LazyImage } from "@/shared/ui/lazy-image";
import { LightRays } from "@/shared/ui/light-rays";
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
        <div className="relative flex flex-col flex-1 px-4 pt-4 pb-3 border-l border-r border-b border-border rounded-b-xl">
          <LightRays />
          <div className="flex flex-col gap-3 h-full flex-1">
            <h3 className="font-bold text-base leading-tight line-clamp-2 text-foreground">
              {formData.title || t("events.eventTitle")}
            </h3>

            {/* Info + Badges - pinned to bottom */}
            <div className="flex items-end justify-between gap-3 mt-auto">
              <div className="space-y-0.5">
                {cardDate && (
                  <span className="block text-[11px] text-muted-foreground">{cardDate}</span>
                )}
                {cardTime && (
                  <span className="block text-[11px] text-muted-foreground">{cardTime}</span>
                )}
                {formData.location && (
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {formData.location}
                  </span>
                )}
              </div>

              {badges.length > 0 && (
                <div className="flex flex-col gap-1.5 items-end shrink-0">
                  {badges.map((badge) => (
                    <span
                      key={badge.text}
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-muted-foreground text-muted-foreground whitespace-nowrap"
                    >
                      {badge.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </article>

      <p className="text-[10px] text-muted-foreground text-center">
        {t("events.previewDescription")}
      </p>
    </div>
  );
}
