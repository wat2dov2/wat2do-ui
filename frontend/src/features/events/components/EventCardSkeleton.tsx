import { CardImageSkeleton } from "@/shared/ui/card-image-skeleton";
import { EventCardContentFrame, EventCardContentSkeleton } from "@/shared/ui/event-card-content";

/** The event card before its event loads, box for box. */
export function EventCardSkeleton() {
  return (
    <article
      data-event-card-skeleton
      data-skeleton-key="card"
      className="flex h-full w-full flex-col rounded-xl"
    >
      <CardImageSkeleton />
      <EventCardContentFrame>
        <EventCardContentSkeleton />
      </EventCardContentFrame>
    </article>
  );
}
