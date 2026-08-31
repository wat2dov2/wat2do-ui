/**
 * Shared visual shell for the content area below an event card image.
 * Used by EventCard, EventFormPreview, and PreviewStyleEventCard.
 */

import { Badge } from "@/shared/ui/badge";
import {
  Calendar,
  Clock,
  MapPin,
  type LucideIcon,
} from "@/shared/ui/doodle-icons";
import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import type { ComponentProps } from "react";

export interface CardBadge {
  text: string;
  size?: "sm" | "md";
  icon?: LucideIcon;
}

const EMPTY_BADGES: readonly CardBadge[] = [];

interface EventCardMetadataLineProps {
  icon: LucideIcon;
  slot: "date" | "time" | "location";
  text: string;
  textClassName: string;
}

function EventCardMetadataLine({
  icon: Icon,
  slot,
  text,
  textClassName,
}: EventCardMetadataLineProps) {
  return (
    <span
      data-slot={`event-card-${slot}`}
      className={cn(
        "flex min-w-0 items-center gap-1 text-[13px]",
        textClassName,
      )}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * Shared lower frame for image-led event and position cards.
 *
 * The page itself owns the surface, so the frame intentionally has no fill,
 * border, or shadow. Keeping that decision here prevents card call sites from
 * drifting back to separate visual shells.
 */
export function EventCardContentFrame({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="event-card-content-frame"
      className={cn(
        "relative z-20 flex flex-1 flex-col overflow-hidden rounded-b-xl rounded-tl-xl text-foreground",
        className,
      )}
      {...props}
    />
  );
}

interface EventCardContentProps {
  title: string;
  titleHref?: string;
  description?: string;
  date?: string;
  time?: string;
  location?: string;
  badges?: readonly CardBadge[];
  /** Popularity line, e.g. "12 clicks · 3 going". */
  statsLabel?: string;
  className?: string;
  textClassName?: string;
  secondaryTextClassName?: string;
  badgeClassName?: string;
  horizontalPadding?: "flush" | "inset";
}

export function EventCardContent({
  title,
  titleHref,
  description,
  date,
  time,
  location,
  badges = EMPTY_BADGES,
  statsLabel,
  className,
  textClassName = "text-foreground",
  secondaryTextClassName = "text-muted-foreground",
  badgeClassName = "border-muted-foreground text-muted-foreground",
  horizontalPadding = "flush",
}: EventCardContentProps) {
  return (
    <div
      data-slot="event-card-content"
      className={cn(
        "relative flex flex-1 flex-col pb-2.5 pt-2 sm:pb-3 sm:pt-2.5",
        horizontalPadding === "inset" && "px-2.5 sm:px-3",
        className,
      )}
    >
      <div className="flex h-full flex-1 flex-col gap-2">
        <div className="min-w-0">
          <h3
            className={cn(
              "line-clamp-2 text-[15px] font-semibold leading-[1.1]",
              textClassName,
            )}
          >
            {titleHref ? (
              <Link href={titleHref} prefetch={false}>
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>
          {statsLabel ? (
            <span
              className={`mt-0.5 block text-[9px] font-medium leading-none ${badgeClassName}`}
            >
              {statsLabel}
            </span>
          ) : null}
          {description ? (
            <p
              className={`mt-2 line-clamp-2 text-xs leading-relaxed ${secondaryTextClassName}`}
            >
              {description}
            </p>
          ) : null}
        </div>

        {date || time || location || badges.length > 0 ? (
          <div className="flex min-w-0 items-end justify-between gap-3">
            <div className="space-y-0.5 min-w-0 flex-1">
              {date ? (
                <EventCardMetadataLine
                  icon={Calendar}
                  slot="date"
                  text={date}
                  textClassName={secondaryTextClassName}
                />
              ) : null}
              {time ? (
                <EventCardMetadataLine
                  icon={Clock}
                  slot="time"
                  text={time}
                  textClassName={secondaryTextClassName}
                />
              ) : null}
              {location ? (
                <EventCardMetadataLine
                  icon={MapPin}
                  slot="location"
                  text={location}
                  textClassName={secondaryTextClassName}
                />
              ) : null}
            </div>

            {badges.length > 0 && (
              /*
               * Capped rather than `shrink-0`: a food badge carries whatever the
               * host typed, so an unbounded one ("Free pizza, samosas and bubble
               * tea") ate the row and squeezed the date, time and location
               * beside it down to a few characters each. Half the row is the
               * most this column may claim; past that the label ellipsises.
               */
              <div className="flex min-w-0 max-w-[50%] shrink flex-col items-end gap-1.5">
                {badges.map((badge) => {
                  const Icon = badge.icon;
                  return (
                    <Badge
                      key={badge.text}
                      variant="outline"
                      size={badge.size ?? "sm"}
                      className={cn("max-w-full gap-1", badgeClassName)}
                    >
                      {Icon ? (
                        <Icon aria-hidden="true" className="size-2.5 shrink-0" />
                      ) : null}
                      <span className="min-w-0 truncate">{badge.text}</span>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
