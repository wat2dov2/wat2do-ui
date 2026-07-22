import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Calendar, ImageOff, MoreHorizontal } from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LazyImage } from "@/shared/ui/lazy-image";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { OrganizationTypeBadge } from "@/shared/components/OrganizationTypeBadge";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { computeEventBadges } from "@/features/events/hooks/useEventBadges";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { cn } from "@/shared/lib/utils";
import { OrganizationBadgeDropdown } from "@/features/organizations";

interface EventFormPreviewProps {
  className?: string;
}

export function EventFormPreview({ className }: EventFormPreviewProps) {
  const { t, i18n } = useTranslation();
  const { formData, imagePreview, selectedOrganizationName } = useEventFormContext();

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

      <article
        className="mx-auto flex w-full max-w-[16.5rem] flex-col overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-border/80"
        >
        <div
          className="relative shrink-0 overflow-hidden rounded-t-xl"
          style={{ height: EVENT_CARD_IMAGE_HEIGHT }}
        >
          <LazyImage
            src={imagePreview || undefined}
            alt={formData.title || t("events.eventTitle")}
            className="absolute inset-0 w-full h-full"
            fallback={
              <div className={`absolute inset-0 bg-surface-elevated flex items-center justify-center`}>
                <ImageOff className={`size-8 text-muted-foreground opacity-60`} />
              </div>
            }
            placeholder={
              <div className={`absolute inset-0 bg-surface-elevated animate-pulse`} />
            }
          />
          
          {formData.category && (
            <BadgeMask variant="top-left">
              <OrganizationTypeBadge type={formData.category} className="opacity-90" />
            </BadgeMask>
          )}

          <BadgeMask variant="bottom-left">
            <OrganizationBadgeDropdown
              organizationName={selectedOrganizationName}
              disabled={true}
            />
          </BadgeMask>
        </div>

        <div
          className={`flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden relative z-20 bg-surface text-foreground border-border`}
        >
          <EventCardContent
            title={formData.title || t("events.eventTitle")}
            date={cardDate || undefined}
            time={cardTime || undefined}
            location={formData.location || undefined}
            badges={badges}
            textClassName="text-muted-foreground"
            secondaryTextClassName="text-muted-foreground"
            badgeClassName="border-border text-muted-foreground"
          />

          <div className={`grid grid-cols-3 border-t border-border`}>
            <div className={`flex min-h-10 w-full items-center justify-center px-2 opacity-75 transition-colors text-muted-foreground`}>
              <Bookmark className="size-4" />
            </div>
            <div className={`flex min-h-10 w-full items-center justify-center border-l px-2 opacity-75 transition-colors border-border text-muted-foreground`}>
              <Calendar className="size-4" />
            </div>
            <div className={`flex min-h-10 w-full items-center justify-center border-l px-2 opacity-75 transition-colors border-border text-muted-foreground`}>
              <MoreHorizontal className="size-4" />
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
