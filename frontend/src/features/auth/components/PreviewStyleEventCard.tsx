/**
 * Event card in the same style as the auth page right-side (hero) section.
 * Used in AuthHeroPanel and OnboardingEventGrid.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Users, ImageOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";
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
  onClick?: () => void;
  /** Optional key for list (e.g. event id when used with real events) */
  "data-event-id"?: number;
}

export function PreviewStyleEventCard({
  event,
  selected = false,
  onClick,
  "data-event-id": dataEventId,
}: PreviewStyleEventCardProps) {
  const { t } = useTranslation();
  const catClasses = getCategoryClasses(event.category);

  // Only attach interactive props when there is an onClick — keeps static
  // a11y analysis happy (role is always present when an event handler is).
  const interactiveProps = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};

  return (
    <div
      {...interactiveProps}
      data-event-id={dataEventId}
      className={cn(
        "rounded-xl overflow-hidden flex flex-col bg-card border border-border",
        onClick && "cursor-pointer transition-shadow duration-200 hover:opacity-90",
        selected && "outline-2 outline-sky-400 dark:outline-sky-300 outline-offset-2 rounded-xl"
      )}
    >
      <div className="relative overflow-hidden" style={{ height: PREVIEW_CARD_IMAGE_HEIGHT }}>
        <LazyImage
          src={event.image}
          alt={event.title}
          className="absolute inset-0 w-full h-full"
          fallback={
            <div className="absolute inset-0 bg-linear-to-br from-muted to-muted/80 flex items-center justify-center">
              <ImageOff className="size-8 text-muted-foreground/40" />
            </div>
          }
          placeholder={
            <div className="absolute inset-0 bg-linear-to-br from-muted to-muted/80 animate-pulse" />
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
          <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-background border border-foreground text-foreground flex items-center gap-1.5">
            <Users className="size-3" strokeWidth={2} />
            <span className="truncate max-w-[80px]">{event.org}</span>
          </span>
        </BadgeMask>
      </div>

      <EventCardContent
        title={event.title}
        date={event.date}
        time={event.time}
        location={event.location}
        badges={event.badges}
      />
    </div>
  );
}
