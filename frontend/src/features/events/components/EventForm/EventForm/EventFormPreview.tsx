import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Download, Heart, ImageOff, Share2 } from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { translateCategory, getCategoryClasses } from "@/shared/utils/event";
import { getEventCardWaterpaintStyle } from "@/shared/utils/eventCardWaterpaint";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { computeEventBadges } from "@/features/events/hooks/useEventBadges";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { cn } from "@/shared/lib/utils";

interface EventFormPreviewProps {
  className?: string;
}

export function EventFormPreview({ className }: EventFormPreviewProps) {
  const { t, i18n } = useTranslation();
  const { formData, imagePreview, selectedOrganizationName } = useEventFormContext();
  const categoryClasses = getCategoryClasses(formData.category);

  // Generate badges matching EventCard structure
  const badges = useMemo(
    () => computeEventBadges(formData, t),
    [formData, t],
  );

  const previewEvent = useMemo(
    () => ({
      occurrences: formData.occurrences.map((o) => ({
        dtstart_utc: o.dtstart_local,
        dtend_utc: o.dtend_local || null,
      })),
    }),
    [formData.occurrences],
  );

  // Format date and time for preview (matching EventCard format)
  const cardDate = useMemo(
    () => formatCardDate(previewEvent, i18n.language || 'en-US'),
    [previewEvent, i18n.language],
  );

  const cardTime = useMemo(
    () => formatCardTime(previewEvent),
    [previewEvent],
  );

  return (
    <div className={cn("min-h-0 w-[22rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-background/40 p-5", className)}>
      <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span className="whitespace-nowrap text-sm font-semibold text-foreground">
          {t("forms.livePreview")}
        </span>
        <span className="text-right text-[11px] leading-snug text-muted-foreground">
          {t("events.previewDescription")}
        </span>
      </div>

      {/* Preview Card - Matches EventCard styling exactly */}
      <article
        className="mx-auto flex w-full max-w-[18.5rem] flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/80"
      >
        {/* Event Image */}
        <div className="relative overflow-hidden" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
          {/* Background - using LazyImage with fallback */}
          <LazyImage
            src={imagePreview || undefined}
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
              <span className="font-bold truncate max-w-[128px]">
                {selectedOrganizationName || t("events.organization")}
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

          <div className={`grid grid-cols-3 border-t ${categoryClasses.border}`}>
            <div className={`flex min-h-10 items-center justify-center gap-1.5 px-2 text-xs font-medium opacity-75 ${categoryClasses.text}`}>
              <Heart className="size-4" />
              <span className="truncate">{t("common.imInterested")}</span>
            </div>
            <div className={`flex min-h-10 items-center justify-center gap-1.5 border-l px-2 text-xs font-medium opacity-75 ${categoryClasses.border} ${categoryClasses.text}`}>
              <Share2 className="size-4" />
              <span className="truncate">{t("common.share")}</span>
            </div>
            <div className={`flex min-h-10 items-center justify-center gap-1.5 border-l px-2 text-xs font-medium opacity-75 ${categoryClasses.border} ${categoryClasses.text}`}>
              <Download className="size-4" />
              <span className="truncate">{t("common.export")}</span>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
