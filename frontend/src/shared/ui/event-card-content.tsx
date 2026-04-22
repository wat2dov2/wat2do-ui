/**
 * Shared visual shell for the content area below an event card image.
 * Used by EventCard, EventFormPreview, and PreviewStyleEventCard.
 */

import { LightRays } from "@/shared/ui/light-rays";

export interface CardBadge {
  text: string;
}

interface EventCardContentProps {
  title: string;
  date?: string;
  time?: string;
  location?: string;
  badges?: CardBadge[];
}

export function EventCardContent({
  title,
  date,
  time,
  location,
  badges = [],
}: EventCardContentProps) {
  return (
    <div className="relative flex flex-col flex-1 px-4 pt-4 pb-3 border-l border-r border-b border-border rounded-b-xl">
      <LightRays />
      <div className="flex flex-col gap-3 h-full flex-1">
        <h3 className="font-bold text-base leading-tight line-clamp-2 text-foreground">
          {title}
        </h3>

        {/* Info + Badges - pinned to bottom */}
        <div className="flex items-end justify-between gap-3 mt-auto">
          <div className="space-y-0.5">
            {date && (
              <span className="block text-[11px] text-muted-foreground">{date}</span>
            )}
            {time && (
              <span className="block text-[11px] text-muted-foreground">{time}</span>
            )}
            {location && (
              <span className="block text-[11px] text-muted-foreground truncate">
                {location}
              </span>
            )}
          </div>

          {badges.length > 0 && (
            <div className="flex flex-col gap-1.5 items-end shrink-0">
              {badges.map((badge) => (
                <span
                  key={badge.text}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-muted-foreground text-muted-foreground whitespace-nowrap"
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
