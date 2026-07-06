/**
 * Event card in the same style as the main event grid, without footer actions.
 * Used in AuthHeroPanel and OnboardingEventGrid.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";
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
  const catClasses = getCategoryClasses(event.category);

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
        "rounded-xl overflow-hidden flex flex-col h-full bg-card transition-all duration-300",
        onMouseDown && "cursor-pointer group hover:opacity-90 hover:shadow-lg",
        selected && "outline-2 outline-sky-400 dark:outline-sky-300 outline-offset-2 rounded-xl",
      )}
    >
      <div className="relative overflow-hidden" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
        <LazyImage
          src={event.image}
          alt={event.title}
          className="absolute inset-0 w-full h-full"
          fallback={
            <div className={cn("absolute inset-0 flex items-center justify-center", catClasses.bg)}>
              <ImageOff className={cn("size-8 opacity-40", catClasses.text)} />
            </div>
          }
          placeholder={
            <div className={cn("absolute inset-0 animate-pulse", catClasses.bg)} />
          }
        />

        <BadgeMask variant="top-left">
          <Badge
            asChild
            variant="outline"
            size="lg"
            className={cn(
              "block border-0 opacity-70",
              catClasses.bg,
              catClasses.text,
            )}
          >
            <span>
              {translateCategory(event.category, t)}
            </span>
          </Badge>
        </BadgeMask>

        {(event.isLive || event.isNew) && (
          <BadgeMask variant="top-right">
            <Badge variant={event.isLive ? "live" : "new"} className="uppercase">
              {event.isLive ? t("common.live") : t("events.new")}
            </Badge>
          </BadgeMask>
        )}

        {event.org && (
          <BadgeMask variant="bottom-left">
            <OrganizationBadgeDropdown organizationName={event.org} disabled={true} />
          </BadgeMask>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden",
          catClasses.bg,
          catClasses.text,
          catClasses.border,
        )}
      >
        <EventCardContent
          title={event.title}
          date={event.date}
          time={event.time}
          location={event.location}
          badges={event.badges}
          textClassName={catClasses.text}
          secondaryTextClassName={catClasses.text}
          badgeClassName={cn("border-current", catClasses.text)}
        />
      </div>
    </div>
  );
}
