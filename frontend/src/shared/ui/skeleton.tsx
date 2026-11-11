import { cn } from "@/shared/lib/utils";

/**
 * A loading placeholder in the colour of the surface it stands in for.
 * It is static: pages show dozens at once, and an animation on each one
 * costs phones a style recalculation and repaint every frame.
 */
/** A skeleton's fill: muted on the page, the page colour on a surface that is already muted. */
const SKELETON_FILL = { page: "bg-muted", muted: "bg-background" } as const;

export function Skeleton({
  className,
  on = "page",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { on?: keyof typeof SKELETON_FILL }) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md", SKELETON_FILL[on], className)}
      {...props}
    />
  );
}

/**
 * One line of text that has not loaded yet. It takes exactly the line box of
 * the text it stands in for (the surrounding font size and line height), so
 * the real line lands where the placeholder was. It is spans throughout, so
 * it may stand inside a heading or paragraph, where a block would break the
 * server's HTML.
 */
export function SkeletonLine({ className }: { className?: string }) {
  return (
    <span data-slot="skeleton-line" aria-hidden="true" className="flex h-[1lh] w-full items-center">
      <span data-slot="skeleton" className={cn("h-[0.75em] w-full rounded-sm bg-muted", className)} />
    </span>
  );
}
