import { Skeleton } from "@/shared/ui/skeleton";
import { useOrganizationCardFrame } from "@/features/organizations/hooks/useOrganizationCardFrame";

export function OrganizationCardSkeleton() {
  const { cardRef, badgeRef, paths } = useOrganizationCardFrame();

  return (
    <article
      data-organization-card-skeleton
      className="relative flex flex-col h-full rounded-xl cursor-default"
      ref={cardRef}
    >
      {/* 1. Custom Background with clip-path (including -webkit support for Safari compatibility) */}
      <div
        className="absolute inset-0 rounded-xl bg-surface"
        style={{
          clipPath: paths.clip ? `path('${paths.clip}')` : undefined,
          WebkitClipPath: paths.clip ? `path('${paths.clip}')` : undefined,
        }}
      />

      {/* 2. Custom Border SVG overlay */}
      {(paths.borderOuter || paths.borderCutout) && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
          {paths.borderOuter && (
            <path
              d={paths.borderOuter}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-border"
            />
          )}
          {paths.borderCutout && (
            <path
              d={paths.borderCutout}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-border"
            />
          )}
        </svg>
      )}

      {/* 3. Category badge skeleton */}
      <div ref={badgeRef} className="absolute top-0 left-0 z-30">
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>

      {/* 4. Simplified skeleton body: just 2 horizontal rectangles inside the outlined card */}
      <div className="relative z-10 flex flex-col flex-1 p-4 pt-20 pb-8 gap-3">
        <Skeleton className="h-4 w-3/4 rounded-lg" />
        <Skeleton className="h-4 w-1/2 rounded-lg" />
      </div>
    </article>
  );
}
