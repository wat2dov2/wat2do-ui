/**
 * Shared visual shell for the content area below an event card image.
 * Used by EventCard, EventFormPreview, and PreviewStyleEventCard.
 */

import { Badge } from "@/shared/ui/badge";
import Link from "next/link";

interface CardBadge {
  text: string;
}

const EMPTY_BADGES: readonly CardBadge[] = [];

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
}: EventCardContentProps) {
  return (
    <div
      className={`relative flex flex-col flex-1 px-2.5 pt-3 pb-2.5 sm:px-3 sm:pt-4 sm:pb-3 ${className ?? ""}`}
    >
      <div className="flex flex-col gap-3 h-full flex-1">
        <div className="min-w-0">
          <h3
            className={`font-semibold text-base leading-[1.1] line-clamp-2 ${textClassName}`}
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
          <div className="flex items-end justify-between gap-3 mt-auto min-w-0">
            <div className="space-y-0.5 min-w-0 flex-1">
              {date && (
                <span
                  className={`block text-[13px] truncate ${secondaryTextClassName}`}
                >
                  {date}
                </span>
              )}
              {time && (
                <span
                  className={`block text-[13px] truncate ${secondaryTextClassName}`}
                >
                  {time}
                </span>
              )}
              {location && (
                <span
                  className={`block text-[13px] truncate ${secondaryTextClassName}`}
                >
                  {location}
                </span>
              )}
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
                {badges.map((badge) => (
                  <Badge
                    key={badge.text}
                    variant="outline"
                    size="sm"
                    className={`block max-w-full truncate ${badgeClassName}`}
                  >
                    {badge.text}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
