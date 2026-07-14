/**
 * Shared visual shell for the content area below an event card image.
 * Used by EventCard, EventFormPreview, and PreviewStyleEventCard.
 */

import { Badge } from "@/shared/ui/badge";

interface CardBadge {
  text: string;
}

const EMPTY_BADGES: readonly CardBadge[] = [];

interface EventCardContentProps {
  title: string;
  date?: string;
  time?: string;
  location?: string;
  badges?: readonly CardBadge[];
  /**
   * Popularity line, e.g. "12 clicks · 3 going".
   * Pass `""` to reserve the same line height before counts load so cards don't
   * stutter; omit the prop entirely when the slot should not exist.
   */
  statsLabel?: string;
  className?: string;
  textClassName?: string;
  secondaryTextClassName?: string;
  badgeClassName?: string;
}

export function EventCardContent({
  title,
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
    <div className={`relative flex flex-col flex-1 px-2.5 pt-3 pb-2.5 sm:px-3 sm:pt-4 sm:pb-3 ${className ?? ""}`}>
      <div className="flex flex-col gap-3 h-full flex-1">
        <div className="min-w-0">
          <h3 className={`font-semibold text-base leading-[1.1] line-clamp-2 ${textClassName}`}>
            {title}
          </h3>
          {statsLabel !== undefined ? (
            <span
              className={`mt-0.5 block text-[9px] font-medium leading-none ${badgeClassName}${
                statsLabel ? "" : " invisible"
              }`}
              aria-hidden={statsLabel ? undefined : true}
            >
              {statsLabel || "\u00a0"}
            </span>
          ) : null}
        </div>

        <div className="flex items-end justify-between gap-3 mt-auto min-w-0">
          <div className="space-y-0.5 min-w-0 flex-1">
            {date && (
              <span className={`block text-[11px] truncate ${secondaryTextClassName}`}>{date}</span>
            )}
            {time && (
              <span className={`block text-[11px] truncate ${secondaryTextClassName}`}>{time}</span>
            )}
            {location && (
              <span className={`block text-[11px] truncate ${secondaryTextClassName}`}>
                {location}
              </span>
            )}
          </div>

          {badges.length > 0 && (
            <div className="flex flex-col gap-1.5 items-end shrink-0">
              {badges.map((badge) => (
                <Badge
                  key={badge.text}
                  variant="outline"
                  size="sm"
                  className={`whitespace-nowrap ${badgeClassName}`}
                >
                  {badge.text}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
