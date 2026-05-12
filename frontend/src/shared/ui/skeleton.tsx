import { cn } from "@/shared/lib/utils";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-secondary", className)}
      {...props}
    />
  );
}

export function EventCardSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden bg-card border border-border flex flex-col h-full">
      {/* Image skeleton */}
      <Skeleton className="w-full" style={{ height: EVENT_CARD_IMAGE_HEIGHT }} />
      
      {/* Content skeleton */}
      <div className="flex flex-col flex-1 p-4 gap-y-3">
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
        <div className="h-px bg-border" />
        <Skeleton className="h-8 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function EventListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}

