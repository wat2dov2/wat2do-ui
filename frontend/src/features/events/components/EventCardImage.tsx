import { useMemo, useState } from "react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import imgLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { Check } from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventImageCutout, useEventImageCutouts } from "@/shared/ui/event-image-cutout";
import { Badge } from "@/shared/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { OrganizationBadgeDropdown } from "@/features/organizations/components/OrganizationBadgeDropdown";
import { useGoingEvents } from "@/features/events/hooks/useGoingEvents";
import { isEventHappeningNow, wasAddedWithinLast24Hours } from "@/shared/utils/date";
import { cn } from "@/shared/lib/utils";
import type { Event } from "@/shared/types";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

// Widths must be values Next will actually serve - the union of its default
// imageSizes and deviceSizes. 384 is the top of imageSizes, which is sized for
// icons, so a card asked for roughly its CSS width and got a third of the
// pixels a retina screen paints it at. These come from deviceSizes instead: a
// grid card is ~190-250 CSS px (570-750 device px at 3x), and the detail poster
// is full width, where 1080 also matches the Instagram source ceiling.
const EVENT_POSTER_WIDTHS = {
  card: 750,
  detail: 1080,
} as const;

interface EventCardImageProps {
  event: Event;
  /** `card` is the grid card's fixed-height header; `detail` is the square poster. */
  variant: "card" | "detail";
  /** Lets the grid card drop its own hover treatment while a badge is hovered. */
  onBadgeHoverChange?: (hovering: boolean) => void;
  /**
   * Renders the organization badge inert. The submit form's live preview shows
   * the badge but must not let its menu filter the feed and leave the form.
   */
  interactive?: boolean;
  /** Runs after the organization badge applies its feed filter. */
  onOrganizationFilterSelect?: () => void;
  /** Load this poster immediately because it can be an initial LCP candidate. */
  priority?: boolean;
}

/**
 * Event poster with its corner badges: new, live, and organization.
 *
 * Every surface that shows an event's artwork shows the same badges in the same
 * corners, so the grid card, the details drawer, and the event page all render
 * this one component instead of repeating the badge row beside the poster.
 */
export function EventCardImage({
  event,
  variant,
  onBadgeHoverChange,
  interactive = true,
  onOrganizationFilterSelect,
  priority = false,
}: EventCardImageProps) {
  const { t } = useTranslation();
  const [imageOpen, setImageOpen] = useState(false);
  const eagerImage = variant === "detail" || priority;
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();

  const isLive = useMemo(() => isEventHappeningNow(event), [event]);
  const isNew = useMemo(() => wasAddedWithinLast24Hours(event), [event]);

  const { data: goingSelections } = useGoingEvents();
  const isGoing = useMemo(
    () => (goingSelections ?? []).some((selection) => selection.event_id === event.id),
    [goingSelections, event.id],
  );

  const badgeHoverProps = useMemo(
    () => ({
      onMouseEnter: () => onBadgeHoverChange?.(true),
      onMouseLeave: () => onBadgeHoverChange?.(false),
    }),
    [onBadgeHoverChange],
  );

  return (
    <>
      <div
        ref={surfaceRef}
        className={cn(
          "relative shrink-0 overflow-hidden",
          variant === "card" ? "rounded-t-xl" : "aspect-square w-full rounded-xl",
        )}
        style={variant === "card" ? { height: EVENT_CARD_IMAGE_HEIGHT } : undefined}
      >
        {/* Masked face: notches are real holes, so the page backdrop shows through. */}
        <EventImageCutout
          backgroundColor="var(--surface-elevated)"
          imageSrc={event.source_image_url}
          imageAlt={event.title}
          imageLoading={eagerImage ? "eager" : "lazy"}
          imageWidth={EVENT_POSTER_WIDTHS[variant]}
          cutouts={cutouts}
          width={box.width}
          height={box.height}
          className="absolute inset-0"
        >
          {variant === "detail" && event.source_image_url ? (
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
          {!event.source_image_url && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Image
                src={imgLogo}
                alt=""
                width={136}
                height={96}
                className="h-2/5 w-2/5 object-contain opacity-80"
              />
            </div>
          )}
        </EventImageCutout>

        {isGoing && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-image-scrim">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-image-scrim-foreground">
              {t("events.going")}
              <Check className="size-4" />
            </span>
          </div>
        )}

        {isNew && (
          <BadgeMask variant="top-left" cutout containerRef={registerCorner("top-left")}>
            <Badge variant="new" size="md" className="flex items-center">
              {t("events.new")}
            </Badge>
          </BadgeMask>
        )}

        {isLive && (
          <BadgeMask variant="top-right" cutout containerRef={registerCorner("top-right")}>
            <Badge variant="live" size="md" className="flex items-center">
              {t("common.live")}
            </Badge>
          </BadgeMask>
        )}

        {event.organization && (
          <BadgeMask variant="bottom-left" cutout containerRef={registerCorner("bottom-left")}>
            <OrganizationBadgeDropdown
              organizationName={event.organization}
              organizationType={event.organization_type}
              school={event.school}
              organizationPage={event.organization_page}
              organizationIg={event.organization_ig}
              organizationDiscord={event.organization_discord}
              disabled={!interactive}
              onFilterSelect={onOrganizationFilterSelect}
              badgeHoverProps={badgeHoverProps}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          </BadgeMask>
        )}
      </div>

      {variant === "detail" && event.source_image_url ? (
        <Dialog open={imageOpen} onOpenChange={setImageOpen}>
          <DialogContent size="xl" className="p-2">
            <DialogTitle className="sr-only">{t("events.viewFullImage")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("events.fullImageDescription", { title: event.title })}
            </DialogDescription>
            <img
              src={event.source_image_url}
              alt={event.title}
              className="max-h-[85dvh] w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
