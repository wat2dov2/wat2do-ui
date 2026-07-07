import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Calendar, ImageOff, MoreHorizontal } from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { translateCategory, getCategoryClasses } from "@/shared/utils/event";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { computeEventBadges } from "@/features/events/hooks/useEventBadges";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { OrganizationBadgeDropdown } from "@/features/organizations";

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

      {/* Preview Card - Matches EventCard styling exactly */}
      <article
        className="mx-auto flex w-full max-w-[16.5rem] flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/80"
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
              <Badge
                asChild
                variant="outline"
                size="lg"
                className={`block border-0 opacity-70 ${
                  categoryClasses.bg
                } ${categoryClasses.text}`}
              >
                <span>
                  {translateCategory(formData.category, t)}
                </span>
              </Badge>
            </BadgeMask>
          )}

          {/* Club/Organization Badge - Bottom Left */}
          <BadgeMask variant="bottom-left">
            <OrganizationBadgeDropdown
              organizationName={selectedOrganizationName}
              disabled={true}
            />
          </BadgeMask>
        </div>

        <div
          className={`flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden relative z-20 ${categoryClasses.bg} ${categoryClasses.text} ${categoryClasses.border}`}
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
            <div className={`flex min-h-10 w-full items-center justify-center px-2 opacity-75 transition-colors ${categoryClasses.text}`}>
              <Bookmark className="size-4" />
            </div>
            <div className={`flex min-h-10 w-full items-center justify-center border-l px-2 opacity-75 transition-colors ${categoryClasses.border} ${categoryClasses.text}`}>
              <Calendar className="size-4" />
            </div>
            <div className={`flex min-h-10 w-full items-center justify-center border-l px-2 opacity-75 transition-colors ${categoryClasses.border} ${categoryClasses.text}`}>
              <MoreHorizontal className="size-4" />
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
