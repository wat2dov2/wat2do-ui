/**
 * Shared visual shell for the content area below an event card image.
 * Used by EventCard, EventFormPreview, and PreviewStyleEventCard.
 */

import { LightRays } from "@/shared/ui/light-rays";

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
  className,
  textClassName = "text-foreground",
  secondaryTextClassName = "text-muted-foreground",
  badgeClassName = "border-muted-foreground text-muted-foreground",
}: EventCardContentProps) {
  return (
    <div className={`relative flex flex-col flex-1 px-4 pt-4 pb-3 ${className ?? ""}`}>
      <LightRays />
      <div className="flex flex-col gap-3 h-full flex-1">
        <h3 className={`font-semibold text-base leading-tight line-clamp-2 ${textClassName}`}>
          {title}
        </h3>

        {/* Info + Badges - pinned to bottom */}
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
                <span
                  key={badge.text}
                  className={`text-[9px] font-medium px-1.5 py-px rounded-full border whitespace-nowrap ${badgeClassName}`}
                >
                  {badge.text}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
