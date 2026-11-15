import type { LucideIcon } from "lucide-react"

import { cn } from "@/shared/lib/utils"

const TILE_CLASS = "flex size-10 shrink-0 flex-col items-center justify-center rounded-xl border border-border bg-surface text-foreground"

/** A small bordered squircle leading a fact or a list row, holding an icon. */
function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div data-slot="icon-tile" aria-hidden="true" className={TILE_CLASS}>
      <Icon className="size-4" />
    </div>
  )
}

/** The same tile as a calendar leaf: a date's month over its day, in the school's time zone. */
function DateTile({ dtstartUtc, locale, timeZone }: { dtstartUtc: string; locale: string; timeZone: string }) {
  const start = new Date(dtstartUtc)
  if (Number.isNaN(start.getTime())) return null
  return (
    <div data-slot="date-tile" aria-hidden="true" className={cn(TILE_CLASS, "gap-0.5")}>
      <span className="text-[9px] font-semibold uppercase leading-none tracking-wide text-muted-foreground">
        {start.toLocaleDateString(locale, { month: "short", timeZone })}
      </span>
      <span className="text-base font-bold leading-none">{start.toLocaleDateString(locale, { day: "numeric", timeZone })}</span>
    </div>
  )
}

export { DateTile, IconTile }
