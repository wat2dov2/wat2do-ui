import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/shared/lib/utils"
import { LazyImage } from "@/shared/ui/lazy-image"
import { logoThumbnailUrl, posterThumbnailUrl } from "@/shared/utils/media"

const TILE_CLASS = "flex size-10 shrink-0 flex-col items-center justify-center rounded-xl border border-border bg-surface text-foreground"
/** The tile's size in CSS px, for the image it holds. */
const TILE_PIXELS = 40

/** A small bordered squircle leading a fact or a list row, holding an icon. */
function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div data-slot="icon-tile" aria-hidden="true" className={TILE_CLASS}>
      <Icon className="size-4" />
    </div>
  )
}

/** A calendar leaf's face: a date's month over its day, in the school's time zone. */
function DateLeaf({ dtstartUtc, locale, timeZone }: { dtstartUtc: string; locale: string; timeZone: string }) {
  const start = new Date(dtstartUtc)
  if (Number.isNaN(start.getTime())) return null
  return (
    <span className="flex flex-col items-center gap-0.5 text-foreground">
      <span className="text-[9px] font-semibold uppercase leading-none tracking-wide text-muted-foreground">
        {start.toLocaleDateString(locale, { month: "short", timeZone })}
      </span>
      <span className="text-base font-bold leading-none">{start.toLocaleDateString(locale, { day: "numeric", timeZone })}</span>
    </span>
  )
}

/** The same tile as a calendar leaf. */
function DateTile(props: { dtstartUtc: string; locale: string; timeZone: string }) {
  return (
    <div data-slot="date-tile" aria-hidden="true" className={TILE_CLASS}>
      <DateLeaf {...props} />
    </div>
  )
}

const THUMBNAIL_URL = { poster: posterThumbnailUrl, logo: logoThumbnailUrl } as const

/**
 * The same tile holding an image, cropped to fill it: an event's poster or a
 * club's logo, shown from its stored thumbnail (the original if that is
 * missing). Without an image, or when it fails to load, it shows `fallback`.
 */
function ImageTile({ src, kind, fallback }: { src: string | null; kind: keyof typeof THUMBNAIL_URL; fallback: ReactNode }) {
  if (!src) {
    return (
      <div data-slot="image-tile" data-image-state="missing" aria-hidden="true" className={TILE_CLASS}>
        {fallback}
      </div>
    )
  }
  return (
    <div data-slot="image-tile" aria-hidden="true" className={cn(TILE_CLASS, "overflow-hidden")}>
      <LazyImage
        src={THUMBNAIL_URL[kind](src)}
        fallbackSrc={src}
        alt=""
        width={TILE_PIXELS}
        height={TILE_PIXELS}
        className="size-full"
        fallback={fallback}
      />
    </div>
  )
}

export { DateLeaf, DateTile, IconTile, ImageTile }
