import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventImageCutout, useEventImageCutouts } from "@/shared/ui/event-image-cutout";
import { Badge } from "@/shared/ui/badge";
import { OrganizationBadgeDropdown } from "@/features/organizations";
import { useGoingEvents } from "@/features/events/hooks/useGoingEvents";
import { getEventCategory } from "@/shared/utils/event";
import { OrganizationCategoryBadge } from "@/shared/components/OrganizationCategoryBadge";
import { isEventHappeningNow, wasAddedWithinLast24Hours } from "@/shared/utils/date";
import { cn } from "@/shared/lib/utils";
import type { Event } from "@/shared/types";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

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
}

/**
 * Event poster with its corner badges: category, live, new, and organization.
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
}: EventCardImageProps) {
  const { t } = useTranslation();
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();

  const eventCategory = useMemo(() => getEventCategory(event), [event]);
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
        cutouts={cutouts}
        width={box.width}
        height={box.height}
        className="absolute inset-0"
      >
        {!event.source_image_url && (
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src="/wat2do-logo.svg"
              alt=""
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

      <BadgeMask variant="top-left" cutout containerRef={registerCorner("top-left")}>
        <OrganizationCategoryBadge type={eventCategory} className="opacity-90" />
      </BadgeMask>

      {isLive && (
        <BadgeMask variant="top-right" cutout containerRef={registerCorner("top-right")}>
          <Badge variant="live" size="md" className="flex items-center">
            {t("common.live")}
          </Badge>
        </BadgeMask>
      )}

      {isNew && (
        <BadgeMask variant="bottom-right" cutout containerRef={registerCorner("bottom-right")}>
          <Badge variant="new" size="md" className="flex items-center">
            {t("events.new")}
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
            badgeHoverProps={badgeHoverProps}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        </BadgeMask>
      )}
    </div>
  );
}
