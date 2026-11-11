import { cn } from "@/shared/lib/utils";

const VARIANTS = {
  /** Over a poster's dark fade, as wide as the card and no taller than three lines of text. */
  card: "max-h-28 w-full",
  /** In the event drawer's heading: as wide as the title, against the left edge, on the drawer itself. */
  heading: "h-24 w-auto max-w-full self-start object-left drop-shadow-sm",
} as const;

/**
 * An event's title the way its poster sets it, from the SVG ingestion drew of
 * it. Shown as an image, so nothing in it can run or load; it is decorative,
 * so the title must also be on the page as text for screen readers.
 */
export function PosterTitleArt({ svg, variant }: { svg: string; variant: keyof typeof VARIANTS }) {
  return (
    <img
      alt=""
      data-slot="poster-title"
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      className={cn("object-contain", VARIANTS[variant])}
    />
  );
}
