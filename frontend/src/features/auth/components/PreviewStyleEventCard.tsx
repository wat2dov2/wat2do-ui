/**
 * Event card in the same style as the auth page right-side (hero) section.
 * Used in AuthHeroPanel and OnboardingEventGrid.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";
import { getEventCardWaterpaintStyle } from "@/shared/utils/eventCardWaterpaint";
import { LazyImage } from "@/shared/ui/lazy-image";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { PREVIEW_CARD_IMAGE_HEIGHT } from "@/features/auth/constants";

export interface PreviewEventData {
  title: string;
  org: string;
  category: string;
  image: string;
  date: string;
  time: string;
  location: string;
  badges: Array<{ text: string; bgClass: string; textClass: string }>;
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

  // Only attach interactive props when there is an onMouseDown — keeps static
  // a11y analysis happy (role is always present when an event handler is).
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
        "rounded-xl overflow-hidden flex flex-col bg-card",
        onMouseDown && "cursor-pointer transition-shadow duration-200 hover:opacity-90",
        selected && "outline-2 outline-sky-400 dark:outline-sky-300 outline-offset-2 rounded-xl"
      )}
    >
      <div className="relative overflow-hidden" style={{ height: PREVIEW_CARD_IMAGE_HEIGHT }}>
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
          <span
            className={cn(
              "font-bold text-[10px] px-2 py-0.5 block rounded-full",
              catClasses.bg,
              catClasses.text
            )}
          >
            {translateCategory(event.category, t)}
          </span>
        </BadgeMask>

        <BadgeMask variant="bottom-left">
          <span className="text-[10px] tracking-normal px-1.5 py-px rounded-full bg-background border border-foreground text-foreground flex items-center">
            <span className="truncate max-w-[112px]">{event.org}</span>
          </span>
        </BadgeMask>
      </div>

      <div
        className={cn(
          "event-card-waterpaint flex flex-col flex-1 border-l border-r border-b rounded-b-xl overflow-hidden",
          "rounded-tl-xl",
          catClasses.bg,
          catClasses.text,
          catClasses.border
        )}
        style={getEventCardWaterpaintStyle(`${event.category}-${event.title}`)}
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
