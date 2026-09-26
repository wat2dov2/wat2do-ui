/**
 * Event card in the same style as the main event grid, without footer actions.
 * Used in onboarding event previews.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";
import { LazyImage } from "@/shared/ui/lazy-image";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { Badge } from "@/shared/ui/badge";
import {
  EventCardContent,
  EventCardContentFrame,
} from "@/shared/ui/event-card-content";
import type { CardBadge } from "@/shared/ui/event-card-content";
import { ClubBadgeDropdown } from "@/features/clubs/components/ClubBadgeDropdown";
import { CARD_GRID_IMAGE_SIZES, EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

export interface PreviewEventData {
  title: string;
  org: string;
  category: string;
  image: string;
  date: string;
  time: string;
  location: string;
  badges: CardBadge[];
  isLive?: boolean;
  isNew?: boolean;
  clubType?: string | null;
  school?: string | null;
}

interface PreviewStyleEventCardProps {
  event: PreviewEventData;
  selected?: boolean;
  onMouseDown?: () => void;
  /** Optional key for list (e.g. event id when used with real events) */
  "data-event-id"?: number;
}

export function PreviewStyleEventCard({
  event,
  selected = false,
  onMouseDown,
  "data-event-id": dataEventId,
}: PreviewStyleEventCardProps) {
  const { t } = useTranslation();

  const interactiveProps = onMouseDown
    ? {
        role: "button" as const,
        tabIndex: 0,
        onMouseDown,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onMouseDown();
          }
        },
      }
    : {};

  return (
    <div
      {...interactiveProps}
      data-event-id={dataEventId}
      className={cn(
        "rounded-xl flex flex-col h-full overflow-hidden transition-all duration-300",
        onMouseDown && "cursor-pointer group hover:shadow-lg",
        selected && "outline-2 outline-sky-400 dark:outline-sky-300 outline-offset-2 rounded-xl",
      )}
    >
      <div
        className="relative shrink-0 overflow-hidden rounded-t-xl"
        style={{ height: EVENT_CARD_IMAGE_HEIGHT }}
      >
        <LazyImage
          src={event.image}
          alt={event.title}
          sizes={CARD_GRID_IMAGE_SIZES}
          className="absolute inset-0 h-full w-full"
          fallback={
            <div className={cn("absolute inset-0 flex items-center justify-center", "bg-surface-elevated")}>
              <ImageOff className={cn("size-8 opacity-40", "text-muted-foreground")} />
            </div>
          }
        />

        {event.isNew && (
          <BadgeMask variant="top-left">
            <Badge variant="new" size="md" className="flex items-center">
              {t("events.new")}
            </Badge>
          </BadgeMask>
        )}

        {event.isLive && (
          <BadgeMask variant="top-right">
            <Badge variant="live" size="md" className="flex items-center">
              {t("common.live")}
            </Badge>
          </BadgeMask>
        )}

        {event.org && (
          <BadgeMask variant="bottom-left">
            <ClubBadgeDropdown
              clubName={event.org}
              clubType={event.clubType}
              school={event.school}
              disabled={true}
            />
          </BadgeMask>
        )}
      </div>

      <EventCardContentFrame>
        <EventCardContent
          title={event.title}
          date={event.date}
          time={event.time}
          location={event.location}
          badges={event.badges}
          textClassName="text-muted-foreground"
          secondaryTextClassName="text-muted-foreground"
          badgeClassName={cn("border-current", "text-muted-foreground")}
        />
      </EventCardContentFrame>
    </div>
  );
}
