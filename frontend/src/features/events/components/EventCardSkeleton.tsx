import { Skeleton } from "@/shared/ui/skeleton";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

export function EventCardSkeleton() {
  return (
    <article
      data-event-card-skeleton
      className="flex h-full flex-col overflow-hidden rounded-xl animate-pulse"
    >
      <div
        className="relative shrink-0 overflow-hidden rounded-t-xl rounded-br-xl bg-muted/30"
        style={{ height: EVENT_CARD_IMAGE_HEIGHT }}
      >
        <Skeleton className="absolute inset-0 w-full h-full rounded-none" />
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-hidden rounded-b-xl rounded-tl-xl pb-2.5 pt-3 sm:gap-3 sm:pb-3 sm:pt-4">
        <div className="flex flex-col gap-2.5 h-full flex-1 sm:gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-3/4 rounded-lg" />
            <Skeleton className="h-4 w-1/2 rounded-lg" />
          </div>

          <div className="flex items-end justify-between gap-3 mt-auto min-w-0">
            <div className="space-y-1.5 min-w-0 flex-1">
              <Skeleton className="h-3 w-1/3 rounded-lg" />
              <Skeleton className="h-3 w-1/2 rounded-lg" />
              <Skeleton className="h-3 w-2/5 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
