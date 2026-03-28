import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users, ImageOff } from "lucide-react";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LazyImage } from "@/shared/ui/lazy-image";
import { LightRays } from "@/shared/ui/light-rays";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { translateCategory, getCategoryClasses } from "@/shared/utils/event";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";

export function EventFormPreview() {
  const { t, i18n } = useTranslation();
  const { formData } = useEventFormContext();

  // Generate badges matching EventCard structure
  const badges = useMemo(() => {
    const badgeList: Array<{ text: string; bgClass: string; textClass: string }> = [];

    // Price badge
    const price = formData.price ?? 0;
    if (price === 0) {
      badgeList.push({
        text: t("common.free"),
        bgClass: "bg-success/20",
        textClass: "text-success",
      });
    } else if (price !== null) {
      badgeList.push({
        text: `$${price}`,
        bgClass: "bg-primary/20",
        textClass: "text-primary",
      });
    }

    // Food badge
    const food = formData.food || [];
    if (food.length > 0) {
      badgeList.push({
        text: t("common.freeFood"),
        bgClass: "bg-warning/20",
        textClass: "text-warning",
      });
    }

    // Registration badge
    if (formData.requiresRegistration) {
      badgeList.push({
        text: t("common.registrationRequired"),
        bgClass: "bg-purple-500/20",
        textClass: "text-purple-500",
      });
    }

    return badgeList;
  }, [formData.price, formData.food, formData.requiresRegistration, t]);

  // Format date and time for preview (matching EventCard format)
  const cardDate = useMemo(() => {
    if (!formData.date) return "";
    // Try to format similar to formatCardDate
    try {
      const date = new Date(formData.date);
      const dayOfWeek = date.toLocaleDateString(i18n.language || 'en-US', { weekday: 'long' });
      const month = date.toLocaleDateString(i18n.language || 'en-US', { month: 'short' });
      const day = date.getDate();
      return `${dayOfWeek} ${month} ${day}`;
    } catch {
      return formData.date;
    }
  }, [formData.date, i18n.language]);

  const cardTime = useMemo(() => {
    if (!formData.time) return "";
    // Format time similar to formatCardTime
    try {
      const [hours, minutes] = formData.time.split(":");
      const h = parseInt(hours);
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      const mins = minutes ? `:${minutes}` : "";
      return `${h12}${mins} ${ampm}`;
    } catch {
      return formData.time;
    }
  }, [formData.time]);

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
        <div className="relative overflow-hidden" style={{ height: "176px" }}>
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
        <div className="relative flex flex-col px-4 pt-4 pb-3 border-l border-r border-b border-border rounded-b-xl">
          <LightRays />
          {/* Title and Badges Row */}
          <div className="flex items-start gap-3">
            {/* Left side: Title, Date, Location */}
            <div className="flex-1 min-w-0 flex flex-col gap-4">
              <h3 className="font-bold text-base leading-tight line-clamp-2 text-foreground">
                {formData.title || t("events.eventTitle")}
              </h3>

              {/* Event Info */}
              <div className="space-y-0.5">
                {/* Date */}
                {cardDate && (
                  <div className="flex gap-1.5 items-center">
                    <span className="text-[11px] text-muted-foreground">
                      {cardDate}
                    </span>
                  </div>
                )}

                {/* Time */}
                {cardTime && (
                  <div className="flex gap-1.5 items-center">
                    <span className="text-[11px] text-muted-foreground">
                      {cardTime}
                    </span>
                  </div>
                )}

                {/* Location */}
                {formData.location && (
                  <div className="flex gap-1.5 items-center">
                    <span className="text-[11px] text-muted-foreground truncate">
                      {formData.location}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right side: Event Badges - Stacked vertically, right aligned */}
            {badges.length > 0 && (
              <div className="flex flex-col gap-1.5 items-end shrink-0">
                {badges.map((badge) => (
                  <span
                    key={badge.text}
                    className={`font-medium text-[10px] px-2 py-0.5 rounded-xl ${badge.bgClass} ${badge.textClass}`}
                  >
                    {badge.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </article>

      <p className="text-[10px] text-muted-foreground text-center">
        {t("events.previewDescription")}
      </p>
    </div>
  );
}
