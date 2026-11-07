import { cn } from "@/shared/lib/utils";

/**
 * A loading placeholder in the colour of the surface it stands in for.
 * It is static: pages show dozens at once, and an animation on each one
 * costs phones a style recalculation and repaint every frame.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/**
 * One line of text that has not loaded yet. It takes exactly the line box of
 * the text it stands in for (the surrounding font size and line height), so
 * the real line lands where the placeholder was.
 */
export function SkeletonLine({ className }: { className?: string }) {
  return (
    <span data-slot="skeleton-line" aria-hidden="true" className="flex h-[1lh] w-full items-center">
      <Skeleton className={cn("h-[0.75em] w-full rounded-sm", className)} />
    </span>
  );
}
