import { Skeleton } from "@/shared/ui/skeleton";

export function OrganizationCardSkeleton() {
  return (
    <article
      data-organization-card-skeleton
      className="rounded-xl overflow-hidden flex flex-col h-full border border-border/50 shadow-sm animate-pulse bg-card"
    >
      {/* Content wrapper with top left category badge placeholder */}
      <div className="relative flex flex-col flex-1 p-3 pb-2.5 pt-10 gap-2.5 sm:p-4 sm:pb-3 sm:pt-11 sm:gap-3">
        {/* Category badge placeholder */}
        <div className="absolute top-0 left-0 flex flex-col">
          <div className="flex">
            <Skeleton className="h-5 w-16 rounded-full rounded-br-xl" />
            <div className="size-2" />
          </div>
          <div className="size-2" />
        </div>

        {/* Title and details */}
        <div className="flex flex-col gap-2.5 h-full flex-1 sm:gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-3/4 rounded-lg" />
            <Skeleton className="h-4 w-1/2 rounded-lg" />
          </div>

          <div className="flex items-end justify-between gap-3 mt-auto min-w-0">
            <div className="space-y-1.5 min-w-0 flex-1">
              <Skeleton className="h-3 w-1/3 rounded-lg" />
              <Skeleton className="h-3 w-1/2 rounded-lg" />
            </div>
          </div>
        </div>
      </div>

      {/* Footer skeleton matching OrganizationFooterActions */}
      <div className="grid grid-cols-3 border-t border-border/50 divide-x divide-border/50 h-10 mt-auto">
        <div className="flex items-center justify-center">
          <Skeleton className="h-3.5 w-12 rounded-lg" />
        </div>
        <div className="flex items-center justify-center">
          <Skeleton className="h-4 w-4 rounded-lg" />
        </div>
        <div className="flex items-center justify-center">
          <Skeleton className="h-4 w-4 rounded-lg" />
        </div>
      </div>
    </article>
  );
}
