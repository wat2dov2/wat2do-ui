import { Skeleton } from "@/shared/ui/skeleton";

/** The club card's shape while the directory loads: logo, follow button, name and meta line. */
export function ClubCardSkeleton() {
  return (
    <article
      data-club-card-skeleton
      className="flex h-full cursor-default flex-col gap-4 rounded-2xl border border-border bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-xl" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4 rounded-lg" />
        <Skeleton className="h-3.5 w-1/2 rounded-lg" />
      </div>
      <Skeleton className="mt-auto h-3.5 w-2/3 rounded-lg" />
    </article>
  );
}
