import { Skeleton } from "@/shared/ui/skeleton";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

export function EventCardSkeleton() {
  return (
    <article
      data-event-card-skeleton
      className="rounded-xl overflow-hidden flex flex-col h-full bg-card border border-border/50 shadow-sm animate-pulse"
    >
      {/* Event Image Placeholder */}
      <div className="relative overflow-hidden bg-muted/30" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
        <Skeleton className="absolute inset-0 w-full h-full rounded-none" />
      </div>

      {/* Bottom section matching EventCard styling */}
      <div className="flex flex-col flex-1 border-l border-r border-b rounded-tl-xl rounded-b-xl overflow-hidden border-border/50 p-3 pb-2.5 bg-card gap-2.5 sm:p-4 sm:pb-3 sm:gap-3">
        <div className="flex flex-col gap-2.5 h-full flex-1 sm:gap-3">
          {/* Title skeleton */}
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-3/4 rounded-lg" />
            <Skeleton className="h-4 w-1/2 rounded-lg" />
          </div>

          {/* Info + Badges pinned to bottom */}
          <div className="flex items-end justify-between gap-3 mt-auto min-w-0">
            <div className="space-y-1.5 min-w-0 flex-1">
              <Skeleton className="h-3 w-1/3 rounded-lg" />
              <Skeleton className="h-3 w-1/2 rounded-lg" />
              <Skeleton className="h-3 w-2/5 rounded-lg" />
            </div>
          </div>
        </div>

        {/* Action Button Skeleton */}
        <div className="w-full pt-3 border-t border-border/50 flex items-center justify-center">
          <Skeleton className="h-4 w-28 rounded-lg" />
        </div>
      </div>
    </article>
  );
}
