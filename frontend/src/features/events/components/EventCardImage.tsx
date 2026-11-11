import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventImageCutout, useEventImageCutouts } from "@/shared/ui/event-image-cutout";
import { Calendar } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ClubBadgeLink } from "@/features/clubs/components/ClubBadgeLink";
import { useGoingEvents } from "@/features/events/hooks/useGoingEvents";
import { hasEventEnded, isEventHappeningNow } from "@/shared/utils/date";
import { getEventImageStatus } from "@/shared/utils/event";
import { cn } from "@/shared/lib/utils";
import type { Event } from "@/shared/types";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

interface EventCardImageProps {
  event: Event;
  /**
   * `card` is the grid card's fixed-height header; `detail` is the square
   * poster, which opens full size and plays the event's video.
   */
  variant: "card" | "detail";
  /**
   * Renders the club badge inert. The submit form's live preview shows
   * the badge but must not let its menu filter the feed and leave the form.
   */
  interactive?: boolean;
  /** Runs after the club badge applies its feed filter. */
  onClubNavigate?: () => void;
  /** Load this poster immediately because it can be an initial LCP candidate. */
  priority?: boolean;
}

/**
 * Event poster with its corner badges: going or new, live, and club.
 *
 * Every surface that shows an event's artwork shows the same badges in the same
 * corners, so the grid card, the details drawer, and the event page all render
 * this one component instead of repeating the badge row beside the poster.
 */
export function EventCardImage({
  event,
  variant,
  interactive = true,
  onClubNavigate,
  priority = false,
}: EventCardImageProps) {
  const { t } = useTranslation();
  const [imageOpen, setImageOpen] = useState(false);
  const isProfileFallback = event.is_directory_event && !event.source_image_url;
  const imageSrc = isProfileFallback ? event.club_logo_url : event.source_image_url;
  const canExpandImage = variant === "detail" && imageSrc && !event.source_video_url && !isProfileFallback;
  const eagerImage = variant === "detail" || priority;
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();

  const isLive = useMemo(() => isEventHappeningNow(event), [event]);
  // Ended events are listed only where the reader asked for history (a club page, a start before now).
  const isPast = useMemo(() => hasEventEnded(event), [event]);

  const { data: goingSelections } = useGoingEvents();
  const isGoing = useMemo(
    () => (goingSelections ?? []).some((selection) => selection.event_id === event.id),
    [goingSelections, event.id],
  );
  const status = getEventImageStatus(event, isGoing);
  // Pulse the Going badge only when the reader marks it here, not for events
  // that were already Going when the selections loaded.
  const selectionsLoaded = goingSelections !== undefined;
  const [previous, setPrevious] = useState({ isGoing, selectionsLoaded });
  const [justWentGoing, setJustWentGoing] = useState(false);
  if (previous.isGoing !== isGoing || previous.selectionsLoaded !== selectionsLoaded) {
    setPrevious({ isGoing, selectionsLoaded });
    setJustWentGoing(isGoing && previous.selectionsLoaded);
  }

  return (
    <>
      <div
        ref={surfaceRef}
        data-slot="event-card-image"
        data-skeleton-key={variant === "card" ? "card-image" : "event-poster"}
        data-variant={variant}
        className={cn(
          "relative shrink-0 overflow-hidden",
          variant === "card" && "rounded-t-xl rounded-br-xl",
          variant === "detail" && "aspect-square w-full rounded-xl",
        )}
        style={variant === "card" ? { height: EVENT_CARD_IMAGE_HEIGHT } : undefined}
      >
        {/* Masked face: notches are real holes, so the page backdrop shows through. */}
        <EventImageCutout
          backgroundColor="var(--surface-elevated)"
          imageSrc={imageSrc}
          imageVariant={isProfileFallback ? "profile" : "poster"}
          videoSrc={variant === "detail" ? event.source_video_url : undefined}
          imageAlt={event.title}
          imageLoading={eagerImage ? "eager" : "lazy"}
          imageFallback={
            <div data-slot="event-poster-fallback" className="flex size-full flex-col items-center justify-center gap-3 px-8 py-10 text-center">
              <Calendar aria-hidden="true" className="size-8 text-primary" />
              <span className="line-clamp-3 text-lg font-semibold leading-tight text-foreground">{event.title}</span>
            </div>
          }
          cutouts={cutouts}
          box={box}
          className="absolute inset-0"
        >
          {canExpandImage ? (
            <button
              type="button"
              className="absolute inset-0 cursor-zoom-in"
              aria-label={t("events.viewFullImage")}
              onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
              onClick={(mouseEvent) => {
                mouseEvent.stopPropagation();
                setImageOpen(true);
              }}
            />
          ) : null}
        </EventImageCutout>

        {status && (
          <BadgeMask variant="top-left" cutout containerRef={registerCorner("top-left")}>
            <Badge
              variant={status}
              size="md"
              data-settle=""
              className={cn(justWentGoing && status === "going" && "animate-success-pulse")}
            >
              {t(`events.${status}`)}
            </Badge>
          </BadgeMask>
        )}

        {isLive && (
          <BadgeMask variant="top-right" cutout containerRef={registerCorner("top-right")}>
            <Badge variant="live" size="md" className="flex items-center" data-settle="">
              {t("common.live")}
            </Badge>
          </BadgeMask>
        )}

        {isPast && (
          <BadgeMask variant="top-right" cutout containerRef={registerCorner("top-right")}>
            <Badge variant="muted" size="md" data-settle="">
              {t("events.past")}
            </Badge>
          </BadgeMask>
        )}

        {event.club && !(variant === "detail" && event.source_video_url) && (
          <BadgeMask variant="bottom-left" cutout containerRef={registerCorner("bottom-left")}>
            <ClubBadgeLink
              clubId={event.club_id}
              clubName={event.club}
              clubLogoUrl={event.club_logo_url}
              cohosts={event.cohosts}
              clubType={event.club_type}
              school={event.school}
              disabled={!interactive}
              onNavigate={onClubNavigate}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          </BadgeMask>
        )}
      </div>

      {canExpandImage ? (
        <Dialog open={imageOpen} onOpenChange={setImageOpen}>
          <DialogContent size="xl" className="p-2">
            <DialogTitle className="sr-only">{t("events.viewFullImage")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("events.fullImageDescription", { title: event.title })}
            </DialogDescription>
            <img
              src={imageSrc}
              alt={event.title}
              className="max-h-[85dvh] w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
