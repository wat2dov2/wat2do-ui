/**
 * Event card in the same style as the main event grid, without footer actions.
 * Used in AuthHeroPanel and OnboardingEventGrid.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";
import { OrganizationCategoryBadge } from "@/shared/components/OrganizationCategoryBadge";
import { LazyImage } from "@/shared/ui/lazy-image";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { Badge } from "@/shared/ui/badge";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { OrganizationBadgeDropdown } from "@/features/organizations";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

export interface PreviewEventData {
  title: string;
  org: string;
  category: string;
  image: string;
  date: string;
  time: string;
  location: string;
  badges: Array<{ text: string; bgClass: string; textClass: string }>;
  isLive?: boolean;
  isNew?: boolean;
  organizationType?: string | null;
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
        "rounded-xl flex flex-col h-full bg-surface overflow-hidden transition-all duration-300",
        onMouseDown && "cursor-pointer group hover:opacity-90 hover:shadow-lg",
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
          className="absolute inset-0 h-full w-full"
          fallback={
            <div className={cn("absolute inset-0 flex items-center justify-center", "bg-surface-elevated")}>
              <ImageOff className={cn("size-8 opacity-40", "text-muted-foreground")} />
            </div>
          }
          placeholder={
            <div className={cn("absolute inset-0 animate-pulse", "bg-surface-elevated")} />
          }
        />

        <BadgeMask variant="top-left">
          <OrganizationCategoryBadge type={event.category} className="opacity-90" />
        </BadgeMask>

        {event.isLive && (
          <BadgeMask variant="top-right">
            <Badge variant="live" size="md" className="flex items-center">
              {t("common.live")}
            </Badge>
          </BadgeMask>
        )}

        {event.isNew && (
          <BadgeMask variant="bottom-right">
            <Badge variant="new" size="md" className="flex items-center">
              {t("events.new")}
            </Badge>
          </BadgeMask>
        )}

        {event.org && (
          <BadgeMask variant="bottom-left">
            <OrganizationBadgeDropdown
              organizationName={event.org}
              organizationType={event.organizationType}
              school={event.school}
              disabled={true}
            />
          </BadgeMask>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden relative z-20",
          "bg-surface text-foreground border-border",
        )}
      >
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
      </div>
    </div>
  );
}
